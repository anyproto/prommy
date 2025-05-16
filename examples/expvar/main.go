package main

import (
	"expvar"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"runtime"
	"time"

	"github.com/anyproto/prommy"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

var (
	// ExpVars - these are automatically exposed via /debug/vars
	requests   = expvar.NewInt("requests_total")
	errors     = expvar.NewInt("errors_total")
	lastAccess = expvar.NewString("last_access_time")

	// Custom map for dynamic values
	statusCodes = expvar.NewMap("status_codes")
)

// updateMemStats reads current memory stats
// Note: Go already exposes memory stats via expvar.Get("memstats"),
// so we don't need to publish them ourselves
func updateMemStats() {
	// Force a memory stats update - expvar will pick up the latest values automatically
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
}

// simulateActivity randomly increments some metrics
func simulateActivity() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	// HTTP status codes for simulation
	httpCodes := []string{"200", "404", "500", "302", "403"}

	for range ticker.C {
		// Increment request counter
		requests.Add(1)

		// Randomly increment error counter
		if rand.Intn(5) == 0 {
			errors.Add(1)
		}

		// Update last access time
		lastAccess.Set(time.Now().Format(time.RFC3339))

		// Increment a random status code
		statusCode := httpCodes[rand.Intn(len(httpCodes))]
		statusCodes.Add(statusCode, 1)

		// Update memory stats occasionally
		if rand.Intn(5) == 0 {
			updateMemStats()
		}
	}
}

// setupExpvarRoutes adds a couple of demo HTTP handlers that are monitored with expvar
func setupExpvarRoutes() {
	http.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		statusCodes.Add("200", 1)
		lastAccess.Set(time.Now().Format(time.RFC3339))
		fmt.Fprintf(w, "Hello, World!")
	})

	http.HandleFunc("/error", func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		errors.Add(1)
		statusCodes.Add("500", 1)
		lastAccess.Set(time.Now().Format(time.RFC3339))
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprintf(w, "Simulated Error!")
	})
}

func main() {
	// Initialize random number generator
	rand.Seed(time.Now().UnixNano())

	// Expose expvar metrics under /debug/vars (standard Go behavior)
	// This is automatically registered by the expvar package

	// Set up Prometheus registry
	reg := prometheus.NewRegistry()

	// Register Go collectors - standard metrics about the Go runtime
	reg.MustRegister(collectors.NewGoCollector())

	// Register expvar collector - this will collect all exported expvars
	// and make them available as Prometheus metrics
	reg.MustRegister(collectors.NewExpvarCollector(nil))

	// Set up routes for demonstrating expvar usage
	setupExpvarRoutes()

	// Update memory stats initially
	updateMemStats()

	// Start simulating activity
	go simulateActivity()

	// Periodically update memory stats
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			updateMemStats()
		}
	}()

	// Configure dashboard layout based on actual metric names from the table view
	dashboardConfig := `[
		[
			{"name": "go_memstats_heap_alloc_bytes", "short": "Heap"},
			{"name": "go_memstats_heap_objects", "short": "Objects"},
			{"name": "go_goroutines", "short": "Goroutines"}
		],
		[
			{"name": "go_memstats_gc_sys_bytes", "short": "GC Mem"},
			{"name": "go_memstats_alloc_bytes", "short": "Alloc"},
			{"name": "go_threads", "short": "Threads"}
		]
	]`

	// Start the prommy server on a different port to avoid conflicts
	log.Println("Starting Prommy server with expvar metrics on :8081")
	log.Println("Visit http://localhost:8081/ for dashboard")
	log.Println("Visit http://localhost:8081/debug/vars for raw expvar data")
	log.Println("Try http://localhost:8081/hello and http://localhost:8081/error to see metrics change")

	if err := prommy.Serve(":8081",
		prommy.WithRegistry(reg),
		prommy.WithTickerInterval(time.Second),
		prommy.WithDashboardJSON(dashboardConfig),
	); err != nil {
		log.Fatalf("Error starting server: %v", err)
	}
}
