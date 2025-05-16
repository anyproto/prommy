package prommy

import (
	"os"
	"testing"
	"time"
)

func TestWithTickerInterval(t *testing.T) {
	tests := []struct {
		name     string
		interval time.Duration
		want     time.Duration
	}{
		{
			name:     "default value",
			interval: 0,
			want:     time.Second,
		},
		{
			name:     "custom value",
			interval: 5 * time.Second,
			want:     5 * time.Second,
		},
		{
			name:     "minimum value",
			interval: 100 * time.Millisecond,
			want:     100 * time.Millisecond,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create default config
			cfg := &Config{
				Registry:       nil,
				TickerInterval: time.Second, // Default
			}

			// Apply the option if interval is set
			if tt.interval > 0 {
				WithTickerInterval(tt.interval)(cfg)
			}

			// Check if the interval was set correctly
			if cfg.TickerInterval != tt.want {
				t.Errorf("WithTickerInterval(%v) = %v, want %v", tt.interval, cfg.TickerInterval, tt.want)
			}
		})
	}
}

func TestWithBasicAuth(t *testing.T) {
	cfg := &Config{}
	username := "admin"
	password := "secret"

	WithBasicAuth(username, password)(cfg)

	if cfg.BasicAuth == nil {
		t.Fatal("WithBasicAuth did not set BasicAuth")
	}

	if cfg.BasicAuth.Username != username {
		t.Errorf("WithBasicAuth username = %v, want %v", cfg.BasicAuth.Username, username)
	}

	if cfg.BasicAuth.Password != password {
		t.Errorf("WithBasicAuth password = %v, want %v", cfg.BasicAuth.Password, password)
	}
}

func TestWithDashboard(t *testing.T) {
	t.Run("Old string format", func(t *testing.T) {
		cfg := &Config{}
		layout := [][]string{
			{"metric1", "metric2"},
			{"metric3"},
		}

		WithDashboardStrings(layout)(cfg)

		if cfg.Dashboard == nil {
			t.Fatal("WithDashboardStrings did not set Dashboard")
		}

		if len(cfg.Dashboard) != 2 {
			t.Errorf("WithDashboardStrings row count = %v, want %v", len(cfg.Dashboard), 2)
		}

		if len(cfg.Dashboard[0]) != 2 {
			t.Errorf("WithDashboardStrings first row length = %v, want %v", len(cfg.Dashboard[0]), 2)
		}

		// Test conversion of string to interface
		s, ok := cfg.Dashboard[0][0].(string)
		if !ok {
			t.Errorf("WithDashboardStrings[0][0] is not a string, got %T", cfg.Dashboard[0][0])
		}
		if s != "metric1" {
			t.Errorf("WithDashboardStrings[0][0] = %v, want %v", s, "metric1")
		}
	})

	t.Run("New map format", func(t *testing.T) {
		cfg := &Config{}
		layout := [][]interface{}{
			{
				map[string]string{"name": "metric1", "short": "M1"},
				map[string]string{"name": "metric2", "short": "M2"},
			},
			{
				map[string]string{"name": "metric3", "short": "M3"},
			},
		}

		WithDashboard(layout)(cfg)

		if cfg.Dashboard == nil {
			t.Fatal("WithDashboard did not set Dashboard")
		}

		if len(cfg.Dashboard) != 2 {
			t.Errorf("WithDashboard row count = %v, want %v", len(cfg.Dashboard), 2)
		}

		if len(cfg.Dashboard[0]) != 2 {
			t.Errorf("WithDashboard first row length = %v, want %v", len(cfg.Dashboard[0]), 2)
		}

		// Test map structure
		m, ok := cfg.Dashboard[0][0].(map[string]string)
		if !ok {
			t.Errorf("WithDashboard[0][0] is not a map[string]string, got %T", cfg.Dashboard[0][0])
		}
		if m["name"] != "metric1" {
			t.Errorf("WithDashboard[0][0]['name'] = %v, want %v", m["name"], "metric1")
		}
		if m["short"] != "M1" {
			t.Errorf("WithDashboard[0][0]['short'] = %v, want %v", m["short"], "M1")
		}
	})
}

func TestWithDashboardJSON(t *testing.T) {
	cfg := &Config{}
	jsonLayout := `[
		[
			{"name": "metric1", "short": "M1"}, 
			{"name": "metric2", "short": "M2"}
		],
		[
			"metric3", 
			"metric4"
		]
	]`

	WithDashboardJSON(jsonLayout)(cfg)

	if cfg.Dashboard == nil {
		t.Fatal("WithDashboardJSON did not set Dashboard")
	}

	if len(cfg.Dashboard) != 2 {
		t.Errorf("WithDashboardJSON row count = %v, want %v", len(cfg.Dashboard), 2)
	}

	if len(cfg.Dashboard[0]) != 2 {
		t.Errorf("WithDashboardJSON first row length = %v, want %v", len(cfg.Dashboard[0]), 2)
	}

	// Test map structure in first row
	m, ok := cfg.Dashboard[0][0].(map[string]interface{})
	if !ok {
		t.Errorf("WithDashboardJSON[0][0] is not a map[string]interface{}, got %T", cfg.Dashboard[0][0])
	} else if m["name"] != "metric1" || m["short"] != "M1" {
		t.Errorf("WithDashboardJSON[0][0] values incorrect, got %v", m)
	}

	// Test string in second row
	s, ok := cfg.Dashboard[1][0].(string)
	if !ok {
		t.Errorf("WithDashboardJSON[1][0] is not a string, got %T", cfg.Dashboard[1][0])
	} else if s != "metric3" {
		t.Errorf("WithDashboardJSON[1][0] = %v, want %v", s, "metric3")
	}

	// Test invalid JSON
	cfg = &Config{}
	WithDashboardJSON("invalid json")(cfg)
	if cfg.Dashboard != nil {
		t.Errorf("WithDashboardJSON should not set dashboard for invalid JSON")
	}
}

func TestEnvVarConfig(t *testing.T) {
	// Save original env vars to restore later
	origInterval := os.Getenv("PROMMY_INTERVAL")
	origDashboard := os.Getenv("PROMMY_DASHBOARD")
	origUser := os.Getenv("PROMMY_BASIC_AUTH_USER")
	origPass := os.Getenv("PROMMY_BASIC_AUTH_PASS")

	defer func() {
		os.Setenv("PROMMY_INTERVAL", origInterval)
		os.Setenv("PROMMY_DASHBOARD", origDashboard)
		os.Setenv("PROMMY_BASIC_AUTH_USER", origUser)
		os.Setenv("PROMMY_BASIC_AUTH_PASS", origPass)
	}()

	// Test interval env var
	os.Setenv("PROMMY_INTERVAL", "2000")
	cfg := &Config{TickerInterval: time.Second}
	applyEnvConfig(cfg)
	if cfg.TickerInterval != 2*time.Second {
		t.Errorf("ENV PROMMY_INTERVAL=2000, got %v, want %v", cfg.TickerInterval, 2*time.Second)
	}

	// Test dashboard env var - old format (string array)
	os.Setenv("PROMMY_DASHBOARD", `[["metric1"],["metric2"]]`)
	cfg = &Config{}
	applyEnvConfig(cfg)
	if len(cfg.Dashboard) != 2 {
		t.Errorf("ENV PROMMY_DASHBOARD (string format) not applied correctly, dashboard length: %v", len(cfg.Dashboard))
	} else {
		val, ok := cfg.Dashboard[0][0].(string)
		if !ok || val != "metric1" {
			t.Errorf("ENV PROMMY_DASHBOARD (string format) not parsed correctly, got %v", cfg.Dashboard[0][0])
		}
	}

	// Test dashboard env var - new format (map with name and short)
	os.Setenv("PROMMY_DASHBOARD", `[[{"name":"metric1","short":"M1"}],[{"name":"metric2","short":"M2"}]]`)
	cfg = &Config{}
	applyEnvConfig(cfg)
	if len(cfg.Dashboard) != 2 {
		t.Errorf("ENV PROMMY_DASHBOARD (map format) not applied correctly, dashboard length: %v", len(cfg.Dashboard))
	} else {
		val, ok := cfg.Dashboard[0][0].(map[string]interface{})
		if !ok {
			t.Errorf("ENV PROMMY_DASHBOARD (map format) not parsed correctly, got type %T", cfg.Dashboard[0][0])
		} else if val["name"] != "metric1" || val["short"] != "M1" {
			t.Errorf("ENV PROMMY_DASHBOARD (map format) values incorrect, got %v", val)
		}
	}

	// Test basic auth env vars
	os.Setenv("PROMMY_BASIC_AUTH_USER", "envuser")
	os.Setenv("PROMMY_BASIC_AUTH_PASS", "envpass")
	cfg = &Config{}
	applyEnvConfig(cfg)
	if cfg.BasicAuth == nil || cfg.BasicAuth.Username != "envuser" || cfg.BasicAuth.Password != "envpass" {
		t.Errorf("ENV PROMMY_BASIC_AUTH_* not applied correctly, got %v", cfg.BasicAuth)
	}
}
