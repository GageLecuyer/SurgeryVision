package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"
)

type Recording struct {
	ID        int       `json:"id"`
	Label     string    `json:"label"`
	Status    string    `json:"status"`
	StartedAt time.Time `json:"startedAt"`
}

type Overlay struct {
	Label    string `json:"label"`
	Value    string `json:"value"`
	Severity string `json:"severity"`
}

type Alert struct {
	ID        int       `json:"id"`
	Title     string    `json:"title"`
	Severity  string    `json:"severity"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

type Patient struct {
	ChartNumber string   `json:"chartNumber"`
	FullName    string   `json:"fullName"`
	Age         int      `json:"age"`
	DOB         string   `json:"dob"`
	BloodType   string   `json:"bloodType"`
	Allergies   []string `json:"allergies"`
	Diagnosis   string   `json:"diagnosis"`
	Procedure   string   `json:"procedure"`
	Room        string   `json:"room"`
	Surgeon     string   `json:"surgeon"`
}

type State struct {
	SystemName        string      `json:"systemName"`
	Mode              string      `json:"mode"`
	GestureEnabled    bool        `json:"gestureEnabled"`
	VoiceEnabled      bool        `json:"voiceEnabled"`
	Recording         bool        `json:"recording"`
	Playback          bool        `json:"playback"`
	LastGesture       string      `json:"lastGesture"`
	LastVoiceCommand  string      `json:"lastVoiceCommand"`
	RiskLevel         int         `json:"riskLevel"`
	PatientStatus     string      `json:"patientStatus"`
	ActiveProcedure   string      `json:"activeProcedure"`
	Patient           Patient     `json:"patient"`
	Overlays          []Overlay   `json:"overlays"`
	Alerts            []Alert     `json:"alerts"`
	Recordings        []Recording `json:"recordings"`
	LastUpdated       time.Time   `json:"lastUpdated"`
}

type server struct {
	mu           sync.RWMutex
	state        State
	nextAlertID  int
	nextRecordID int
}

type modeRequest struct {
	Mode string `json:"mode"`
}

type gestureRequest struct {
	Gesture string `json:"gesture"`
}

type voiceRequest struct {
	Command string `json:"command"`
}

func newServer() *server {
	now := time.Now()
	patient := patientDatabase()["CH-20481"]
	return &server{
		nextAlertID:  3,
		nextRecordID: 3,
		state: State{
			SystemName:       "AI Touchless Surgical Platform",
			Mode:             "ANALYSIS",
			GestureEnabled:   true,
			VoiceEnabled:     true,
			Recording:        false,
			Playback:         false,
			LastGesture:      "Pinch Zoom",
			LastVoiceCommand: "Display vascular map",
			RiskLevel:        28,
			PatientStatus:    "Stable",
			ActiveProcedure:  patient.Procedure,
			Patient:          patient,
			Overlays: []Overlay{
				{Label: "Vitals Sync", Value: "98.2%", Severity: "normal"},
				{Label: "Tool Proximity", Value: "Safe", Severity: "normal"},
				{Label: "Occlusion Risk", Value: "Low", Severity: "low"},
			},
			Alerts: []Alert{
				{ID: 1, Title: "Perfusion drift", Severity: "medium", Message: "Perfusion trend changed by 8% in the last 30 seconds.", Timestamp: now.Add(-2 * time.Minute)},
				{ID: 2, Title: "Gesture confidence dip", Severity: "low", Message: "Hand tracking briefly fell below 92% confidence.", Timestamp: now.Add(-45 * time.Second)},
			},
			Recordings: []Recording{
				{ID: 1, Label: "Pre-op simulation", Status: "completed", StartedAt: now.Add(-75 * time.Minute)},
				{ID: 2, Label: "Tissue scan rehearsal", Status: "completed", StartedAt: now.Add(-22 * time.Minute)},
			},
			LastUpdated: now,
		},
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/platform/state", s.handleState)
	mux.HandleFunc("/api/platform/mode", s.handleMode)
	mux.HandleFunc("/api/platform/gesture", s.handleGesture)
	mux.HandleFunc("/api/platform/voice", s.handleVoice)
	mux.HandleFunc("/api/platform/patient", s.handlePatientLookup)
	mux.HandleFunc("/api/platform/recordings/start", s.handleStartRecording)
	mux.HandleFunc("/api/platform/recordings/stop", s.handleStopRecording)
	mux.HandleFunc("/api/platform/recordings/playback", s.handlePlayback)
	return withCORS(mux)
}

func (s *server) simulate() {
	ticker := time.NewTicker(4 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()

		s.state.RiskLevel = clamp(s.state.RiskLevel+rand.Intn(17)-8, 4, 97)
		switch {
		case s.state.RiskLevel >= 75:
			s.state.PatientStatus = "Critical review"
		case s.state.RiskLevel >= 45:
			s.state.PatientStatus = "Heightened monitoring"
		default:
			s.state.PatientStatus = "Stable"
		}

		s.state.Overlays = []Overlay{
			{Label: "Vitals Sync", Value: percentString(95 + rand.Intn(5)), Severity: "normal"},
			{Label: "Tool Proximity", Value: toolProximityLabel(), Severity: riskSeverity(s.state.RiskLevel)},
			{Label: "Occlusion Risk", Value: riskBand(s.state.RiskLevel), Severity: riskSeverity(s.state.RiskLevel)},
		}

		if s.state.RiskLevel >= 70 {
			s.nextAlertID++
			s.state.Alerts = prependAlert(trimAlerts(s.state.Alerts), Alert{
				ID:        s.nextAlertID,
				Title:     "Elevated risk detected",
				Severity:  "high",
				Message:   "Risk engine flagged a sustained anomaly. Recommend switching to review posture.",
				Timestamp: time.Now(),
			})
		} else {
			s.state.Alerts = trimAlerts(s.state.Alerts)
		}

		s.state.LastUpdated = time.Now()
		s.mu.Unlock()
	}
}

func (s *server) handleState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	writeJSON(w, http.StatusOK, s.state)
}

func (s *server) handleMode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req modeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	if req.Mode != "LOCKED" && req.Mode != "ANALYSIS" && req.Mode != "LIVE" {
		http.Error(w, "invalid mode", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.state.Mode = req.Mode
	s.state.LastUpdated = time.Now()
	s.addAlertLocked("Mode transition", "low", "System mode changed to "+req.Mode+".")
	state := s.state
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, state)
}

func (s *server) handleGesture(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req gestureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Gesture == "" {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.state.LastGesture = req.Gesture
	s.state.LastUpdated = time.Now()
	s.addAlertLocked("Gesture event", "low", "Detected gesture command: "+req.Gesture+".")
	state := s.state
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, state)
}

func (s *server) handleVoice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req voiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Command == "" {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.state.LastVoiceCommand = req.Command
	s.state.LastUpdated = time.Now()
	s.addAlertLocked("Voice event", "low", "Voice command processed: "+req.Command+".")
	state := s.state
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, state)
}

func (s *server) handlePatientLookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	chart := r.URL.Query().Get("chart")
	if chart == "" {
		http.Error(w, "chart query is required", http.StatusBadRequest)
		return
	}

	patient, ok := patientDatabase()[chart]
	if !ok {
		http.Error(w, "patient not found", http.StatusNotFound)
		return
	}

	s.mu.Lock()
	s.state.Patient = patient
	s.state.ActiveProcedure = patient.Procedure
	s.state.LastUpdated = time.Now()
	state := s.state
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, state)
}

func (s *server) handleStartRecording(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	s.nextRecordID++
	s.state.Recording = true
	s.state.Playback = false
	s.state.Recordings = append([]Recording{{
		ID:        s.nextRecordID,
		Label:     "Live capture",
		Status:    "recording",
		StartedAt: time.Now(),
	}}, s.state.Recordings...)
	s.state.LastUpdated = time.Now()
	state := s.state
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, state)
}

func (s *server) handleStopRecording(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	s.state.Recording = false
	for i := range s.state.Recordings {
		if s.state.Recordings[i].Status == "recording" {
			s.state.Recordings[i].Status = "completed"
			s.state.Recordings[i].Label = "Intra-op capture"
			break
		}
	}
	s.state.LastUpdated = time.Now()
	state := s.state
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, state)
}

func (s *server) handlePlayback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	s.state.Playback = !s.state.Playback
	s.state.LastUpdated = time.Now()
	state := s.state
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, state)
}

func (s *server) addAlertLocked(title, severity, message string) {
	s.nextAlertID++
	s.state.Alerts = prependAlert(trimAlerts(s.state.Alerts), Alert{
		ID:        s.nextAlertID,
		Title:     title,
		Severity:  severity,
		Message:   message,
		Timestamp: time.Now(),
	})
}

func trimAlerts(alerts []Alert) []Alert {
	if len(alerts) > 5 {
		return alerts[:5]
	}
	return alerts
}

func prependAlert(alerts []Alert, alert Alert) []Alert {
	alerts = append([]Alert{alert}, alerts...)
	if len(alerts) > 5 {
		return alerts[:5]
	}
	return alerts
}

func riskBand(risk int) string {
	switch {
	case risk >= 75:
		return "High"
	case risk >= 45:
		return "Moderate"
	default:
		return "Low"
	}
}

func riskSeverity(risk int) string {
	switch {
	case risk >= 75:
		return "high"
	case risk >= 45:
		return "medium"
	default:
		return "low"
	}
}

func toolProximityLabel() string {
	labels := []string{"Safe", "Watch", "Review arc"}
	return labels[rand.Intn(len(labels))]
}

func patientDatabase() map[string]Patient {
	return map[string]Patient{
		"CH-20481": {
			ChartNumber: "CH-20481",
			FullName:    "Elena Martinez",
			Age:         42,
			DOB:         "1983-11-06",
			BloodType:   "O+",
			Allergies:   []string{"Penicillin", "Latex"},
			Diagnosis:   "Gallbladder inflammation with recurrent pain",
			Procedure:   "Robotic laparoscopic cholecystectomy",
			Room:        "OR-4",
			Surgeon:     "Dr. Henry Lawson",
		},
		"CH-10752": {
			ChartNumber: "CH-10752",
			FullName:    "Marcus Lee",
			Age:         58,
			DOB:         "1968-03-22",
			BloodType:   "A-",
			Allergies:   []string{"None listed"},
			Diagnosis:   "Left renal mass under operative review",
			Procedure:   "Robotic partial nephrectomy",
			Room:        "OR-2",
			Surgeon:     "Dr. Priya Nair",
		},
		"CH-88214": {
			ChartNumber: "CH-88214",
			FullName:    "Naomi Brooks",
			Age:         35,
			DOB:         "1990-07-14",
			BloodType:   "B+",
			Allergies:   []string{"Morphine"},
			Diagnosis:   "Stage II endometriosis with chronic pelvic pain",
			Procedure:   "Robotic excision and pelvic mapping",
			Room:        "OR-6",
			Surgeon:     "Dr. Sophia Grant",
		},
	}
}

func percentString(value int) string {
	return fmt.Sprintf("%d%%", value)
}

func clamp(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func main() {
	rand.Seed(time.Now().UnixNano())
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := newServer()
	go srv.simulate()

	log.Printf("Backend listening on http://localhost:%s\n", port)
	if err := http.ListenAndServe(":"+port, srv.routes()); err != nil {
		log.Fatal(err)
	}
}
