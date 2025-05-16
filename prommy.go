// Package prommy provides a lightweight Prometheus metrics dashboard with real-time WebSocket updates.
package prommy

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// Option is a functional option for configuring the prommy server.
type Option func(*Config)

// Config holds the configuration for the prommy server.
type Config struct {
	Registry       *prometheus.Registry
	TickerInterval time.Duration
	StaticFS       fs.FS
	BasicAuth      *BasicAuth
	Dashboard      [][]interface{} // Can be string or map with name and short fields
	PrefixURI      string          // URI prefix that will be trimmed from requests
}

// BasicAuth contains username and password for basic authentication.
type BasicAuth struct {
	Username string
	Password string
}

// WithRegistry sets a custom Prometheus registry.
func WithRegistry(reg *prometheus.Registry) Option {
	return func(c *Config) {
		c.Registry = reg
	}
}

// WithTickerInterval sets the interval for sending metrics updates.
func WithTickerInterval(d time.Duration) Option {
	return func(c *Config) {
		c.TickerInterval = d
	}
}

// WithStaticFS sets a custom filesystem for serving static assets.
func WithStaticFS(fsys fs.FS) Option {
	return func(c *Config) {
		c.StaticFS = fsys
	}
}

// WithBasicAuth enables HTTP basic authentication with the provided credentials.
func WithBasicAuth(username, password string) Option {
	return func(c *Config) {
		c.BasicAuth = &BasicAuth{
			Username: username,
			Password: password,
		}
	}
}

// WithDashboard sets a custom dashboard layout for metrics display.
// Each item can be a string (metric name) or a map with "name" and optional "short" fields.
func WithDashboard(layout [][]interface{}) Option {
	return func(c *Config) {
		c.Dashboard = layout
	}
}

// WithDashboardOld sets a custom dashboard layout for metrics display using the old string-only format.
// This is kept for backward compatibility.
func WithDashboardStrings(layout [][]string) Option {
	return func(c *Config) {
		// Convert [][]string to [][]interface{}
		dashboard := make([][]interface{}, len(layout))
		for i, row := range layout {
			dashboard[i] = make([]interface{}, len(row))
			for j, item := range row {
				dashboard[i][j] = item
			}
		}
		c.Dashboard = dashboard
	}
}

// WithDashboardJSON sets a custom dashboard layout using a JSON string.
// This provides a more convenient way to define layouts inline.
// Example: `[["metric1", "metric2"], [{"name": "metric3", "short": "M3"}]]`
func WithDashboardJSON(jsonLayout string) Option {
	return func(c *Config) {
		var dashboard [][]interface{}
		if err := json.Unmarshal([]byte(jsonLayout), &dashboard); err != nil {
			// Log error but don't fail - will use default dashboard
			log.Printf("Error parsing dashboard JSON: %v", err)
			return
		}
		c.Dashboard = dashboard
	}
}

// WithPrefixURI sets a custom URI prefix for serving the dashboard.
// The prefix will be trimmed from all requests before handling.
func WithPrefixURI(prefix string) Option {
	return func(c *Config) {
		c.PrefixURI = prefix
	}
}

// Handler returns an http.HandlerFunc that serves the metrics dashboard.
// This function can be used to register the handler with a custom path prefix.
//
// Usage:
//
//	http.HandleFunc("/custom/path/", prommy.Handler(opts...))
func Handler(opts ...Option) http.HandlerFunc {
	// Create default config
	cfg := &Config{
		Registry:       prometheus.DefaultRegisterer.(*prometheus.Registry),
		TickerInterval: time.Second,
	}

	// Apply options
	for _, opt := range opts {
		opt(cfg)
	}

	// Check environment variables for configuration
	applyEnvConfig(cfg)

	// Register default collectors if using the default registry
	if cfg.Registry == prometheus.DefaultRegisterer {
		cfg.Registry.MustRegister(
			prometheus.NewGoCollector(),
			prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
		)
	}

	// Initialize the server
	server, err := newServer(cfg)
	if err != nil {
		log.Printf("Failed to initialize Prommy server: %v", err)
		return func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Prommy server initialization failed", http.StatusInternalServerError)
		}
	}

	// Return a handler function that strips the path prefix and serves the request
	return server.ServeHTTP
}

// Serve starts the prommy server on the specified address.
// It registers default Prometheus collectors if no custom registry is provided.
func Serve(addr string, opts ...Option) error {
	// Create default config
	cfg := &Config{
		Registry:       prometheus.NewRegistry(),
		TickerInterval: time.Second,
	}

	// Apply options
	for _, opt := range opts {
		opt(cfg)
	}

	// Check environment variables for configuration
	applyEnvConfig(cfg)

	// Register default collectors if using the default registry
	if cfg.Registry == prometheus.DefaultRegisterer {
		cfg.Registry.MustRegister(
			prometheus.NewGoCollector(),
			prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
		)
	}

	// Initialize the server
	server, err := newServer(cfg)
	if err != nil {
		return fmt.Errorf("failed to initialize server: %w", err)
	}

	// Start the server
	return http.ListenAndServe(addr, server)
}

// applyEnvConfig applies configuration from environment variables.
func applyEnvConfig(cfg *Config) {
	// Apply basic auth from environment variables
	username := os.Getenv("PROMMY_BASIC_AUTH_USER")
	password := os.Getenv("PROMMY_BASIC_AUTH_PASS")
	if username != "" && password != "" && cfg.BasicAuth == nil {
		cfg.BasicAuth = &BasicAuth{
			Username: username,
			Password: password,
		}
	}

	// Apply ticker interval from environment variable
	if intervalStr := os.Getenv("PROMMY_INTERVAL"); intervalStr != "" {
		if ms, err := strconv.Atoi(intervalStr); err == nil && ms > 0 {
			cfg.TickerInterval = time.Duration(ms) * time.Millisecond
		}
	}

	// Apply URI prefix from environment variable
	if prefix := os.Getenv("PROMMY_PREFIX_URI"); prefix != "" && cfg.PrefixURI == "" {
		cfg.PrefixURI = prefix
	}

	// Try to get dashboard from environment variable if not set via options
	if cfg.Dashboard == nil {
		if dashEnv := os.Getenv("PROMMY_DASHBOARD"); dashEnv != "" {
			var dashboard [][]interface{}
			if err := json.Unmarshal([]byte(dashEnv), &dashboard); err == nil {
				cfg.Dashboard = dashboard
			}
		}
	}
}
