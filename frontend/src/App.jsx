import { useEffect, useRef, useState } from 'react';

const API_BASE = 'http://localhost:8080/api/platform';
const SAMPLE_CHARTS = ['CH-20481', 'CH-10752', 'CH-88214'];
const MODES = ['LOCKED', 'ANALYSIS', 'LIVE'];
const GESTURES = ['Pinch Zoom', 'Rotate View', 'Freeze Overlay', 'Focus Scan'];
const VOICE_COMMANDS = ['Display vascular map', 'Start risk scan', 'Mark region', 'Switch to live guidance'];
const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];
const PAGE_ORDER = ['patient', 'vision', 'simulation', 'files'];
const PAGE_LABELS = {
  patient: 'Patient Dashboard',
  vision: 'Live Surgery',
  simulation: 'Surgery Simulation',
  files: 'Recording Files'
};

const fallbackState = {
  mode: 'ANALYSIS',
  gestureEnabled: true,
  voiceEnabled: true,
  recording: false,
  playback: false,
  lastGesture: 'Pinch Zoom',
  lastVoiceCommand: 'Display vascular map',
  riskLevel: 28,
  patientStatus: 'Stable',
  activeProcedure: 'Robotic laparoscopic cholecystectomy',
  patient: {
    chartNumber: 'CH-20481',
    fullName: 'Elena Martinez',
    age: 42,
    dob: '1983-11-06',
    bloodType: 'O+',
    allergies: ['Penicillin', 'Latex'],
    diagnosis: 'Gallbladder inflammation with recurrent pain',
    procedure: 'Robotic laparoscopic cholecystectomy',
    room: 'OR-4',
    surgeon: 'Dr. Henry Lawson'
  },
  overlays: [
    { label: 'Vitals Sync', value: '98.2%', severity: 'normal' },
    { label: 'Tool Proximity', value: 'Safe', severity: 'normal' },
    { label: 'Occlusion Risk', value: 'Low', severity: 'low' }
  ],
  alerts: [],
  recordings: [],
  lastUpdated: new Date().toISOString()
};

const gestureGuide = {
  'Pinch Zoom': {
    symbol: '\uD83E\uDD0F',
    fingers: 'Thumb + index finger',
    howTo: 'Bring your thumb and index finger together, then move the pinch closer to or farther from the camera.',
    effect: 'Zooms the surgical view in or out for detail.'
  },
  'Rotate View': {
    symbol: '\u270C\uFE0F',
    fingers: 'Two fingers up',
    howTo: 'Hold up your index and middle finger, then twist your wrist left or right.',
    effect: 'Rotates the 3D anatomy view.'
  },
  'Freeze Overlay': {
    symbol: '\u270B',
    fingers: 'Open palm',
    howTo: 'Show a flat open hand directly to the camera and hold still for a moment.',
    effect: 'Freezes the current overlay frame for review.'
  },
  'Focus Scan': {
    symbol: '\u261D\uFE0F',
    fingers: 'Single index finger',
    howTo: 'Point one finger toward the target region and keep the fingertip inside the camera view.',
    effect: 'Focuses the scan ring on a tighter area.'
  }
};

function App() {
  const [platform, setPlatform] = useState(fallbackState);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState('patient');
  const [chartInput, setChartInput] = useState(fallbackState.patient.chartNumber);
  const [patientLookupError, setPatientLookupError] = useState('');
  const [cameraStatus, setCameraStatus] = useState('Requesting camera access...');
  const [cameraReady, setCameraReady] = useState(false);
  const [cvStatus, setCvStatus] = useState('Loading hand tracking...');
  const [trackedHands, setTrackedHands] = useState(0);
  const [detectedGesture, setDetectedGesture] = useState('Waiting for hand');
  const [viewerAsset, setViewerAsset] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState(fallbackState.lastVoiceCommand);
  const [savedRecordings, setSavedRecordings] = useState([]);
  const [selectedSavedRecordingId, setSelectedSavedRecordingId] = useState(null);
  const [surgeryEnded, setSurgeryEnded] = useState(false);
  const [simulationPaused, setSimulationPaused] = useState(false);
  const [simulationZoom, setSimulationZoom] = useState(1);
  const [voiceNavStatus, setVoiceNavStatus] = useState('Voice navigation ready.');
  const [voiceNavListening, setVoiceNavListening] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const viewerUrlRef = useRef(null);
  const handsRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastGestureSentAtRef = useRef(0);
  const platformGestureRef = useRef(fallbackState.lastGesture);
  const gestureCandidateRef = useRef({ name: null, count: 0 });
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const simulationMediaRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    platformGestureRef.current = platform.lastGesture;
  }, [platform.lastGesture]);

  useEffect(() => {
    return () => {
      setSavedRecordings((current) => {
        current.forEach((item) => URL.revokeObjectURL(item.url));
        return current;
      });
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadState = async () => {
      try {
        const response = await fetch(`${API_BASE}/state`);
        if (!response.ok) {
          throw new Error('Failed to load platform state');
        }

        const normalized = normalizePlatformState(await response.json());
        if (!cancelled) {
          setPlatform(normalized);
          setChartInput(normalized.patient.chartNumber);
          setSelectedVoice(normalized.lastVoiceCommand);
          setConnected(true);
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadState();
    const interval = setInterval(loadState, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus('This browser does not support webcam access.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });

        if (ignore) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(() => {
              setCameraStatus('Camera connected, but playback was blocked. Click the page and allow autoplay if prompted.');
            });
          };
        }
        setCameraReady(true);
        setCameraStatus('Live surgery feed connected. Keep your hand inside the guidance frame.');
      } catch {
        setCameraReady(false);
        setCameraStatus('Camera access was blocked, or no webcam was found. Allow camera permission in the browser.');
      }
    };

    startCamera();

    return () => {
      ignore = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!cameraReady || !videoRef.current) {
      return undefined;
    }

    if (!window.Hands) {
      setCvStatus('MediaPipe failed to load. Check your internet connection and refresh.');
      return undefined;
    }

    let cancelled = false;
    let lastVideoTime = -1;
    const hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    hands.onResults((results) => {
      if (cancelled) {
        return;
      }

      drawLandmarks(results, canvasRef.current, videoRef.current);

      const landmarks = results.multiHandLandmarks?.[0];
      const tracked = results.multiHandLandmarks?.length ?? 0;
      setTrackedHands(tracked);

      if (!landmarks) {
        setDetectedGesture('Waiting for hand');
        setCvStatus('No hand detected. Raise one hand into the frame.');
        return;
      }

      const gesture = detectGesture(landmarks);
      const stableGesture = getStableGesture(gestureCandidateRef, gesture);
      setDetectedGesture(stableGesture ?? gesture ?? 'Hand detected');
      setCvStatus(
        stableGesture
          ? `Tracking ${stableGesture}`
          : gesture
            ? `Pose seen: ${gesture}. Hold it steady to activate.`
            : 'Hand detected. Adjust your fingers to match a command.'
      );

      if (!stableGesture) {
        return;
      }

      const now = Date.now();
      if (now - lastGestureSentAtRef.current < 1400) {
        return;
      }

      if (stableGesture !== platformGestureRef.current) {
        lastGestureSentAtRef.current = now;
        sendAction('/gesture', { gesture: stableGesture });
      }
    });

    handsRef.current = hands;
    setCvStatus('Hand tracking active. Show one of the guided poses.');

    const detectFrame = async () => {
      const video = videoRef.current;
      if (!video || cancelled) {
        return;
      }

      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        await hands.send({ image: video });
      }

      animationFrameRef.current = requestAnimationFrame(detectFrame);
    };

    animationFrameRef.current = requestAnimationFrame(detectFrame);

    return () => {
      cancelled = true;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setTrackedHands(0);
      setDetectedGesture('Waiting for hand');
      if (handsRef.current?.close) {
        handsRef.current.close();
      }
      handsRef.current = null;
      gestureCandidateRef.current = { name: null, count: 0 };
    };
  }, [cameraReady]);

  useEffect(() => {
    return () => {
      if (viewerUrlRef.current) {
        URL.revokeObjectURL(viewerUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const toggleVoiceNavigation = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceNavStatus('Voice navigation not supported in this browser.');
      return;
    }

    if (voiceNavListening && recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setVoiceNavListening(false);
      setVoiceNavStatus('Voice navigation stopped.');
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
      if (transcript.includes('next tab')) {
        const index = PAGE_ORDER.indexOf(page);
        setPage(PAGE_ORDER[(index + 1) % PAGE_ORDER.length]);
        setVoiceNavStatus('Voice command: next tab');
      } else if (transcript.includes('back tab') || transcript.includes('previous tab')) {
        const index = PAGE_ORDER.indexOf(page);
        setPage(PAGE_ORDER[(index - 1 + PAGE_ORDER.length) % PAGE_ORDER.length]);
        setVoiceNavStatus('Voice command: previous tab');
      } else if (transcript.includes('live surgery')) {
        setPage('vision');
        setVoiceNavStatus('Voice command: live surgery');
      } else if (transcript.includes('surgery simulation') || transcript.includes('simulation')) {
        setPage('simulation');
        setVoiceNavStatus('Voice command: surgery simulation');
      } else if (transcript.includes('patient dashboard')) {
        setPage('patient');
        setVoiceNavStatus('Voice command: patient dashboard');
      } else if (transcript.includes('recording files') || transcript.includes('files tab')) {
        setPage('files');
        setVoiceNavStatus('Voice command: recording files');
      }
    };

    recognition.onerror = () => {
      setVoiceNavListening(false);
      setVoiceNavStatus('Voice navigation paused. Microphone permission may be blocked.');
    };

    recognition.onend = () => {
      setVoiceNavListening(false);
      recognitionRef.current = null;
      setVoiceNavStatus('Voice navigation stopped.');
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setVoiceNavListening(true);
      setVoiceNavStatus('Voice navigation listening: say "next tab", "back tab", or a page name.');
    } catch {
      setVoiceNavListening(false);
      setVoiceNavStatus('Voice navigation could not start.');
    }
  };

  const sendAction = async (path, payload = undefined) => {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined
      });

      if (!response.ok) {
        throw new Error('Request failed');
      }

      const normalized = normalizePlatformState(await response.json());
      setPlatform(normalized);
      setChartInput(normalized.patient.chartNumber);
      setSelectedVoice(normalized.lastVoiceCommand);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  const lookupPatient = async (chart) => {
    try {
      const response = await fetch(`${API_BASE}/patient?chart=${encodeURIComponent(chart)}`);
      if (!response.ok) {
        throw new Error('Patient not found');
      }

      const normalized = normalizePlatformState(await response.json());
      setPlatform(normalized);
      setChartInput(normalized.patient.chartNumber);
      setPatientLookupError('');
      setConnected(true);
    } catch {
      setPatientLookupError('No patient chart found for that ID.');
    }
  };

  const handleChartSubmit = async (event) => {
    event.preventDefault();
    await lookupPatient(chartInput.trim());
  };

  const handleMediaUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (viewerUrlRef.current) {
      URL.revokeObjectURL(viewerUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    viewerUrlRef.current = url;
    setViewerAsset({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type.startsWith('video/') ? 'video' : 'image',
      url
    });
    setSimulationPaused(false);
    setSimulationZoom(1);
    setPage('simulation');
  };

  const startSavedRecording = async () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setCameraStatus('Recording is not available in this browser or camera stream.');
      return;
    }

    if (mediaRecorderRef.current?.state === 'recording') {
      return;
    }

    setSurgeryEnded(false);
    recordingChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      if (recordingChunksRef.current.length === 0) {
        return;
      }

      const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const id = crypto.randomUUID();
      const fileName = `${platform.patient.chartNumber}-${Date.now()}.webm`;
      const newRecording = {
        id,
        name: fileName,
        url,
        createdAt: new Date().toLocaleString()
      };

      setSavedRecordings((current) => [newRecording, ...current]);
      setSelectedSavedRecordingId(id);
      setSurgeryEnded(true);
      setPage('files');
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    await sendAction('/recordings/start');
  };

  const stopSavedRecording = async () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    await sendAction('/recordings/stop');
    setSurgeryEnded(true);
  };

  const togglePlayback = async () => {
    if (savedRecordings.length > 0) {
      setSelectedSavedRecordingId(savedRecordings[0].id);
      setPage('files');
    }
    await sendAction('/recordings/playback');
  };

  const toggleSimulationPlayback = () => {
    if (!viewerAsset || viewerAsset.type !== 'video' || !simulationMediaRef.current) {
      return;
    }
    if (simulationMediaRef.current.paused) {
      simulationMediaRef.current.play();
      setSimulationPaused(false);
    } else {
      simulationMediaRef.current.pause();
      setSimulationPaused(true);
    }
  };

  const zoomSimulation = (delta) => {
    setSimulationZoom((current) => Math.min(2.5, Math.max(0.7, current + delta)));
  };

  const selectedSavedRecording = savedRecordings.find((item) => item.id === selectedSavedRecordingId) || null;
  const vision = getVisionState(platform);
  const activeGesture = gestureGuide[platform.lastGesture];
  const patient = platform.patient;

  return (
    <div className="shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Hospital Workflow</p>
          <h1>Patient Chart And Vision Suite</h1>
          <p className="lede voice-line">{voiceNavStatus}</p>
          <button className={`voice-toggle ${voiceNavListening ? 'active' : ''}`} onClick={toggleVoiceNavigation}>
            {voiceNavListening ? 'Stop Voice Navigation' : 'Start Voice Navigation'}
          </button>
        </div>
        <div className={`status-pill ${connected ? 'online' : 'offline'}`}>
          <span className="status-dot" />
          {connected ? 'Hospital Database Connected' : 'Offline Demo Mode'}
        </div>
      </header>

      <div className="page-switcher">
        {PAGE_ORDER.map((pageKey) => (
          <button key={pageKey} className={`page-tab ${page === pageKey ? 'active' : ''}`} onClick={() => setPage(pageKey)}>
            {PAGE_LABELS[pageKey]}
          </button>
        ))}
      </div>

      {page === 'patient' ? (
        <main className="grid">
          <section className="panel panel-primary">
            <div className="panel-header">
              <span className="panel-kicker">Patient Database</span>
              <h2>Chart lookup</h2>
            </div>
            <form className="chart-form" onSubmit={handleChartSubmit}>
              <input
                className="chart-input"
                value={chartInput}
                onChange={(event) => setChartInput(event.target.value)}
                placeholder="Enter chart number"
              />
              <button className="chart-submit" type="submit">Load chart</button>
            </form>
            <div className="sample-charts">
              {SAMPLE_CHARTS.map((chart) => (
                <button key={chart} className="sample-chart-chip" onClick={() => lookupPatient(chart)}>
                  {chart}
                </button>
              ))}
            </div>
            {patientLookupError && <p className="lookup-error">{patientLookupError}</p>}
            <div className="patient-summary-grid">
              <Metric label="Patient" value={patient.fullName} />
              <Metric label="Chart" value={patient.chartNumber} />
              <Metric label="Room" value={patient.room} />
              <Metric label="DOB" value={patient.dob} />
              <Metric label="Age" value={String(patient.age)} />
              <Metric label="Blood type" value={patient.bloodType} />
              <Metric label="Surgeon" value={patient.surgeon} />
              <Metric label="Diagnosis" value={patient.diagnosis} />
              <Metric label="Allergies" value={patient.allergies.join(', ')} />
              <Metric label="Procedure" value={patient.procedure} />
              <Metric label="Status" value={platform.patientStatus} />
              <Metric label="Last update" value={new Date(platform.lastUpdated).toLocaleTimeString()} />
            </div>
          </section>

          <section className="panel panel-primary">
            <div className="panel-header">
              <span className="panel-kicker">Modes</span>
              <h2>System posture control</h2>
            </div>
            <div className="mode-row">
              {MODES.map((mode) => (
                <button
                  key={mode}
                  className={`mode-card ${platform.mode === mode ? 'active' : ''}`}
                  onClick={() => sendAction('/mode', { mode })}
                >
                  <strong>{mode}</strong>
                  <span>{mode === 'LOCKED' ? 'No command execution' : mode === 'ANALYSIS' ? 'Review and simulate' : 'Real-time guided mode'}</span>
                </button>
              ))}
            </div>
            <div className="metrics">
              <Metric label="Procedure" value={platform.activeProcedure} />
              <Metric label="Voice" value={platform.lastVoiceCommand} />
              <Metric label="Gesture" value={platform.lastGesture} />
            </div>
          </section>
        </main>
      ) : page === 'vision' ? (
        <main className="grid">
          <section className="panel panel-wide">
            <div className="panel-header">
              <span className="panel-kicker">Computer Vision</span>
              <h2>Live surgery feed</h2>
            </div>
            <div className="vision-layout">
              <div className="vision-screen">
              <div className={`scan-frame ${vision.freeze ? 'freeze' : ''}`}>
                  <video ref={videoRef} className="camera-feed" autoPlay muted playsInline />
                  <canvas ref={canvasRef} className="tracking-overlay" />
                  <div className="camera-tint" />
                  <div className="vision-hud">
                    <span>CV confidence {vision.confidence}%</span>
                    <span>{vision.overlayState}</span>
                    <span>{cameraReady ? 'Webcam live' : 'Camera unavailable'}</span>
                  </div>
                  {surgeryEnded && (
                    <div className="surgery-over-banner">
                      <strong>Surgery Over</strong>
                      <p>Recording saved to the Recording Files tab. Press playback to review the surgery.</p>
                    </div>
                  )}
                  {!cameraReady && (
                    <div className="camera-fallback">
                      <strong>Camera not ready</strong>
                      <p>{cameraStatus}</p>
                    </div>
                  )}
                </div>
                <p className="camera-status">{cameraStatus}</p>
              </div>
              <div className="vision-sidebar">
                <div className="vision-stat-list">
                  <Metric label="Tracked hands" value={`${trackedHands} / 1`} />
                  <Metric label="Gesture inference" value={detectedGesture} />
                  <Metric label="Confidence" value={`${vision.confidence}%`} />
                </div>
                <div className="gesture-effect-card">
                  <p className="panel-kicker">Gesture effect</p>
                  <h3>{platform.lastGesture}</h3>
                  <p className="subtle">{activeGesture.effect}</p>
                  <p className="subtle cv-status-copy">{cvStatus}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="panel panel-wide">
            <div className="panel-header">
              <span className="panel-kicker">Gesture Guide</span>
              <h2>How to do each hand command</h2>
            </div>
            <div className="gesture-guide-grid">
              {GESTURES.map((gesture) => {
                const guide = gestureGuide[gesture];
                return (
                  <button
                    key={gesture}
                    className={`gesture-guide-card ${platform.lastGesture === gesture ? 'active' : ''}`}
                    onClick={() => sendAction('/gesture', { gesture })}
                  >
                    <div className="gesture-guide-head">
                      <span className="gesture-symbol" aria-hidden="true">{guide.symbol}</span>
                      <div>
                        <strong>{gesture}</strong>
                        <span>{guide.fingers}</span>
                      </div>
                    </div>
                    <p>{guide.howTo}</p>
                    <small>{guide.effect}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <span className="panel-kicker">Touchless Controls</span>
              <h2>Gesture and voice commands</h2>
            </div>
            <div className="command-grid">
              <div>
                <h3>Gesture control</h3>
                <p className="subtle">Last gesture: {platform.lastGesture}</p>
                <div className="chip-row">
                  {GESTURES.map((gesture) => (
                    <button
                      key={gesture}
                      className={`chip ${platform.lastGesture === gesture ? 'active' : ''}`}
                      onClick={() => sendAction('/gesture', { gesture })}
                    >
                      {gesture}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h3>Voice control</h3>
                <p className="subtle">Last voice command: {platform.lastVoiceCommand}</p>
                <div className="chip-row">
                  {VOICE_COMMANDS.map((command) => (
                    <button
                      key={command}
                      className={`chip ${selectedVoice === command ? 'active' : ''}`}
                      onClick={() => sendAction('/voice', { command })}
                    >
                      {command}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <span className="panel-kicker">Recording</span>
              <h2>Save live surgery files</h2>
            </div>
            <div className="recording-actions">
              <button className={`action-button ${platform.recording ? 'active' : ''}`} onClick={startSavedRecording}>
                Start recording
              </button>
              <button className={`action-button secondary ${!platform.recording ? 'active' : ''}`} onClick={stopSavedRecording}>
                Stop recording
              </button>
              <button className={`action-button secondary ${platform.playback ? 'active' : ''}`} onClick={togglePlayback}>
                {platform.playback ? 'Stop playback' : 'Play latest'}
              </button>
            </div>
            <div className="recording-status">
              <StatusBadge active={platform.recording} label="Recording" />
              <StatusBadge active={platform.playback} label="Playback" />
            </div>
            <p className="subtle">Saved recordings are moved to the `Recording Files` tab after surgery ends.</p>
          </section>

          <section className="panel">
            <div className="panel-header">
              <span className="panel-kicker">Navigation</span>
              <h2>Hands-free page switching</h2>
            </div>
            <p className="subtle">Say `next tab`, `back tab`, `patient dashboard`, `live surgery`, `surgery simulation`, or `recording files`.</p>
          </section>
        </main>
      ) : page === 'simulation' ? (
        <main className="grid">
          <section className="panel panel-wide">
            <div className="panel-header">
              <span className="panel-kicker">Surgery Simulation</span>
              <h2>Upload and control reference media</h2>
            </div>
            <label className="upload-card">
              <input type="file" accept="image/*,video/*" onChange={handleMediaUpload} />
              <span>Choose image or video</span>
              <small>Upload surgery images or simulation videos to review them here.</small>
            </label>
            <div className="simulation-controls">
              <button className="sample-chart-chip" onClick={toggleSimulationPlayback} disabled={!viewerAsset || viewerAsset.type !== 'video'}>
                {simulationPaused ? 'Resume video' : 'Pause video'}
              </button>
              <button className="sample-chart-chip" onClick={() => zoomSimulation(0.2)} disabled={!viewerAsset}>Zoom in</button>
              <button className="sample-chart-chip" onClick={() => zoomSimulation(-0.2)} disabled={!viewerAsset}>Zoom out</button>
              <button className="sample-chart-chip" onClick={() => setSimulationZoom(1)} disabled={!viewerAsset}>Reset zoom</button>
            </div>
            <div className="media-viewer simulation-viewer">
              {viewerAsset ? (
                <>
                  <div className="media-viewer-header">
                    <strong>{viewerAsset.name}</strong>
                    <span>{viewerAsset.type === 'video' ? 'Simulation video' : 'Simulation image'}</span>
                  </div>
                  <div className="simulation-stage">
                    {viewerAsset.type === 'video' ? (
                      <video
                        ref={simulationMediaRef}
                        className="uploaded-media zoomable-media"
                        src={viewerAsset.url}
                        controls
                        playsInline
                        style={{ transform: `scale(${simulationZoom})` }}
                        onPlay={() => setSimulationPaused(false)}
                        onPause={() => setSimulationPaused(true)}
                      />
                    ) : (
                      <img
                        className="uploaded-media zoomable-media"
                        src={viewerAsset.url}
                        alt={viewerAsset.name}
                        style={{ transform: `scale(${simulationZoom})` }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="media-placeholder">
                  <strong>No simulation media loaded</strong>
                  <p>Upload a surgery image or video to control it from this page.</p>
                </div>
              )}
            </div>
          </section>
        </main>
      ) : (
        <main className="grid">
          <section className="panel panel-primary">
            <div className="panel-header">
              <span className="panel-kicker">Recording Files</span>
              <h2>Saved surgery recordings</h2>
            </div>
            <div className="saved-recordings-list">
              {savedRecordings.length === 0 ? (
                <p className="subtle">No saved recordings yet. Stop a recording on the Live Surgery tab to create one.</p>
              ) : (
                savedRecordings.map((item) => (
                  <article key={item.id} className={`saved-recording-card ${selectedSavedRecordingId === item.id ? 'active' : ''}`}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.createdAt}</span>
                    </div>
                    <div className="saved-recording-actions">
                      <button className="sample-chart-chip" onClick={() => setSelectedSavedRecordingId(item.id)}>Open</button>
                      <a className="sample-chart-chip download-link" href={item.url} download={item.name}>Save file</a>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel panel-primary">
            <div className="panel-header">
              <span className="panel-kicker">Playback</span>
              <h2>Watch saved surgery</h2>
            </div>
            <div className="media-viewer">
              {selectedSavedRecording ? (
                <>
                  <div className="media-viewer-header">
                    <strong>{selectedSavedRecording.name}</strong>
                    <span>Saved recording playback</span>
                  </div>
                  <video className="uploaded-media" src={selectedSavedRecording.url} controls playsInline />
                </>
              ) : (
                <div className="media-placeholder">
                  <strong>No surgery file selected</strong>
                  <p>Choose a file from the list to watch the surgery again.</p>
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      {loading && <div className="loading-banner">Loading platform state...</div>}
    </div>
  );
}

function getVisionState(platform) {
  const zoom = platform.lastGesture === 'Pinch Zoom';
  const rotate = platform.lastGesture === 'Rotate View';
  const freeze = platform.lastGesture === 'Freeze Overlay';
  const focus = platform.lastGesture === 'Focus Scan';

  return {
    zoom,
    rotate,
    freeze,
    focus,
    confidence: Math.max(91, 100 - Math.floor(platform.riskLevel / 3)),
    overlayState: freeze ? 'Overlay locked' : focus ? 'Target narrowed' : rotate ? '3D orbit active' : 'Live segmentation'
  };
}

function detectGesture(landmarks) {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const wrist = landmarks[0];

  const thumbIndexDistance = distance(thumbTip, indexTip);
  const indexMiddleDistance = distance(indexTip, middleTip);
  const extendedCount = countExtendedFingers(landmarks);
  const handSize = Math.max(distance(wrist, middleTip), 0.001);
  const pinchRatio = thumbIndexDistance / handSize;
  const indexExtended = isFingerExtended(landmarks, 8, 6);
  const middleExtended = isFingerExtended(landmarks, 12, 10);
  const ringExtended = isFingerExtended(landmarks, 16, 14);
  const pinkyExtended = isFingerExtended(landmarks, 20, 18);
  const thumbExtended = Math.abs(thumbTip.x - thumbIp.x) > 0.045;

  if (pinchRatio < 0.23 && indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'Pinch Zoom';
  }
  if (extendedCount === 4 && thumbExtended) {
    return 'Freeze Overlay';
  }
  if (extendedCount === 1 && indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'Focus Scan';
  }
  if (indexExtended && middleExtended && !ringExtended && !pinkyExtended && indexMiddleDistance / handSize > 0.16) {
    return 'Rotate View';
  }
  return null;
}

function getStableGesture(candidateRef, gesture) {
  if (!gesture) {
    candidateRef.current = { name: null, count: 0 };
    return null;
  }
  if (candidateRef.current.name === gesture) {
    candidateRef.current = { name: gesture, count: candidateRef.current.count + 1 };
  } else {
    candidateRef.current = { name: gesture, count: 1 };
  }
  return candidateRef.current.count >= 6 ? gesture : null;
}

function countExtendedFingers(landmarks) {
  return FINGER_TIPS.filter((tip, index) => isFingerExtended(landmarks, tip, FINGER_PIPS[index])).length;
}

function isFingerExtended(landmarks, tipIndex, pipIndex) {
  return landmarks[tipIndex].y < landmarks[pipIndex].y;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function drawLandmarks(results, canvas, video) {
  if (!canvas || !video) {
    return;
  }
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, width, height);
  (results.multiHandLandmarks || []).forEach((landmarks) => {
    drawConnections(context, landmarks, width, height);
    landmarks.forEach((point) => {
      context.beginPath();
      context.arc(point.x * width, point.y * height, 5, 0, Math.PI * 2);
      context.fillStyle = 'rgba(109, 226, 255, 0.92)';
      context.fill();
    });
  });
}

function drawConnections(context, landmarks, width, height) {
  const segments = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17]
  ];
  context.strokeStyle = 'rgba(68, 215, 182, 0.72)';
  context.lineWidth = 3;
  segments.forEach(([start, end]) => {
    context.beginPath();
    context.moveTo(landmarks[start].x * width, landmarks[start].y * height);
    context.lineTo(landmarks[end].x * width, landmarks[end].y * height);
    context.stroke();
  });
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ active, label }) {
  return <span className={`status-badge ${active ? 'active' : ''}`}>{label}</span>;
}

function normalizePlatformState(data) {
  return {
    ...fallbackState,
    ...data,
    patient: {
      ...fallbackState.patient,
      ...(data?.patient || {})
    },
    overlays: Array.isArray(data?.overlays) ? data.overlays : fallbackState.overlays,
    alerts: Array.isArray(data?.alerts) ? data.alerts : fallbackState.alerts,
    recordings: Array.isArray(data?.recordings) ? data.recordings : fallbackState.recordings
  };
}

export default App;
