package prommy

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	dto "github.com/prometheus/client_model/go"
)

// Metric represents a simplified metric structure for JSON serialization.
type Metric struct {
	Name   string            `json:"name"`
	Type   string            `json:"type"`
	Help   string            `json:"help,omitempty"`
	Labels map[string]string `json:"labels,omitempty"`
	Value  float64           `json:"value"`
}

// Server handles HTTP requests and WebSocket connections.
type Server struct {
	config    *Config
	hub       *Hub
	upgrader  websocket.Upgrader
	mux       *http.ServeMux
	dashboard [][]interface{} // Dashboard layout configuration
}

// newServer creates a new server with the given configuration.
func newServer(config *Config) (*Server, error) {
	// Create a new WebSocket hub
	hub := newHub()
	go hub.run()

	// Create the server
	s := &Server{
		config: config,
		hub:    hub,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins
			},
		},
		mux: http.NewServeMux(),
	}

	// Set up static file serving
	var staticFS fs.FS
	if config.StaticFS != nil {
		staticFS = config.StaticFS
	} else {
		staticFS = embeddedFiles
	}

	// Set the dashboard configuration
	if config.Dashboard != nil {
		s.dashboard = config.Dashboard
	}

	// Set up routes
	s.setupRoutes(staticFS)

	// Start metrics broadcaster
	go s.broadcastMetrics()

	return s, nil
}

// ServeHTTP implements the http.Handler interface.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Apply basic auth if configured
	if s.config.BasicAuth != nil {
		user, pass, ok := r.BasicAuth()
		if !ok || user != s.config.BasicAuth.Username || pass != s.config.BasicAuth.Password {
			w.Header().Set("WWW-Authenticate", `Basic realm="Restricted"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}

	s.mux.ServeHTTP(w, r)
}

// setupRoutes sets up the HTTP routes.
func (s *Server) setupRoutes(staticFS fs.FS) {
	// Get base prefix path
	prefix := s.config.PrefixURI
	prefix = strings.TrimSuffix(prefix, "/")

	// Metrics endpoint using promhttp
	s.mux.Handle(prefix+"/metrics", http.StripPrefix(prefix, promhttp.HandlerFor(
		s.config.Registry,
		promhttp.HandlerOpts{
			EnableOpenMetrics: true,
		},
	)))

	// WebSocket endpoint
	s.mux.HandleFunc(prefix+"/ws", func(w http.ResponseWriter, r *http.Request) {
		// trim the prefix
		conn, err := s.upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("Error upgrading connection: %v", err)
			return
		}
		s.hub.ServeWebSocket(conn)
	})

	// Dashboard configuration endpoint
	s.mux.HandleFunc(prefix+"/dashboard", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// trim the prefix
		r.URL.Path = strings.TrimPrefix(r.URL.Path, prefix)
		r.URL.RawPath = strings.TrimPrefix(r.URL.RawPath, prefix)
		// If no dashboard is configured, create a default layout
		dashboard := s.dashboard
		if dashboard == nil {
			// Create a default dashboard with all metrics in separate rows
			metrics, err := s.collectMetrics()
			if err == nil {
				dashboard = make([][]interface{}, 0, len(metrics))
				for _, metric := range metrics {
					// For default dashboard, extract a better short name based on metric type
					shortName := metric.Name
					if strings.HasSuffix(metric.Name, "_bytes") {
						shortName = "BYTES"
					} else if strings.HasSuffix(metric.Name, "_total") {
						shortName = "TOTAL"
					} else if strings.HasSuffix(metric.Name, "_count") {
						shortName = "COUNT"
					} else if strings.HasSuffix(metric.Name, "_sum") {
						shortName = "SUM"
					} else {
						// Use last segment of the name
						parts := strings.Split(metric.Name, "_")
						if len(parts) > 0 {
							shortName = parts[len(parts)-1]
						}
					}

					// Create a map with name and short properties
					metricConfig := map[string]string{
						"name":  metric.Name,
						"short": shortName,
					}

					dashboard = append(dashboard, []interface{}{metricConfig})
				}
			} else {
				// Fallback to empty dashboard if can't collect metrics
				dashboard = [][]interface{}{}
			}
		}

		// Marshal and send the dashboard layout
		if err := json.NewEncoder(w).Encode(dashboard); err != nil {
			http.Error(w, "Error encoding dashboard", http.StatusInternalServerError)
		}
	})

	// Static files
	s.mux.Handle(prefix+"/", http.StripPrefix(prefix, http.FileServer(http.FS(staticFS))))
}

// broadcastMetrics periodically collects metrics and broadcasts them to connected clients.
func (s *Server) broadcastMetrics() {
	ticker := time.NewTicker(s.config.TickerInterval)
	defer ticker.Stop()

	for range ticker.C {
		metrics, err := s.collectMetrics()
		if err != nil {
			log.Printf("Error collecting metrics: %v", err)
			continue
		}

		jsonData, err := json.Marshal(metrics)
		if err != nil {
			log.Printf("Error marshaling metrics: %v", err)
			continue
		}

		s.hub.Broadcast(jsonData)
	}
}

// collectMetrics collects metrics from the Prometheus registry.
func (s *Server) collectMetrics() ([]Metric, error) {
	mfs, err := s.config.Registry.Gather()
	if err != nil {
		return nil, fmt.Errorf("error gathering metrics: %w", err)
	}

	var metrics []Metric

	for _, mf := range mfs {
		metricType := metricTypeToString(mf.GetType())

		for _, m := range mf.GetMetric() {
			// Extract labels
			labels := make(map[string]string)
			for _, lp := range m.GetLabel() {
				labels[lp.GetName()] = lp.GetValue()
			}

			// Extract value based on metric type
			var value float64
			switch mf.GetType() {
			case dto.MetricType_COUNTER:
				value = m.GetCounter().GetValue()
			case dto.MetricType_GAUGE:
				value = m.GetGauge().GetValue()
			case dto.MetricType_SUMMARY:
				// For summaries, we'll export count and sum
				value = m.GetSummary().GetSampleSum()
				// Create an additional entry for sample count
				countMetric := Metric{
					Name:   mf.GetName() + "_count",
					Type:   metricType,
					Help:   mf.GetHelp(),
					Labels: labels,
					Value:  float64(m.GetSummary().GetSampleCount()),
				}
				metrics = append(metrics, countMetric)
			case dto.MetricType_HISTOGRAM:
				// For histograms, we'll export count and sum
				value = m.GetHistogram().GetSampleSum()
				// Create an additional entry for sample count
				countMetric := Metric{
					Name:   mf.GetName() + "_count",
					Type:   metricType,
					Help:   mf.GetHelp(),
					Labels: labels,
					Value:  float64(m.GetHistogram().GetSampleCount()),
				}
				metrics = append(metrics, countMetric)

				// Add histogram bucket metrics to enable visualization
				for _, bucket := range m.GetHistogram().GetBucket() {
					bucketLabels := make(map[string]string)
					for k, v := range labels {
						bucketLabels[k] = v
					}
					bucketLabels["le"] = fmt.Sprintf("%g", bucket.GetUpperBound())

					bucketMetric := Metric{
						Name:   mf.GetName() + "_bucket",
						Type:   metricType,
						Help:   mf.GetHelp(),
						Labels: bucketLabels,
						Value:  float64(bucket.GetCumulativeCount()),
					}
					metrics = append(metrics, bucketMetric)
				}
			default:
				continue // Skip unsupported types
			}

			metric := Metric{
				Name:   mf.GetName(),
				Type:   metricType,
				Help:   mf.GetHelp(),
				Labels: labels,
				Value:  value,
			}

			metrics = append(metrics, metric)
		}
	}

	return metrics, nil
}

// metricTypeToString converts a Prometheus metric type to a string representation.
func metricTypeToString(metricType dto.MetricType) string {
	switch metricType {
	case dto.MetricType_COUNTER:
		return "counter"
	case dto.MetricType_GAUGE:
		return "gauge"
	case dto.MetricType_SUMMARY:
		return "summary"
	case dto.MetricType_HISTOGRAM:
		return "histogram"
	default:
		return "unknown"
	}
}
