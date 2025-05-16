package main

import (
	"log"
	"math/rand"
	"net/http"
	"time"

	"github.com/anyproto/prommy"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	dto "github.com/prometheus/client_model/go"
)

func main() {
	// Create a new registry
	reg := prometheus.NewRegistry()

	// Register some custom metrics
	httpRequestsTotal := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests by status code and method.",
		},
		[]string{"code", "method"},
	)

	httpRequestDuration := prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latencies in seconds.",
			Buckets: prometheus.LinearBuckets(0.1, 0.2, 10), // More visible buckets: 0.1, 0.3, 0.5, 0.7, ...
		},
		[]string{"handler", "method"},
	)

	// Add a second histogram with a different distribution to showcase the visualization
	responseSize := prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "http_response_size_bytes",
			Help:    "HTTP response sizes in bytes.",
			Buckets: prometheus.ExponentialBuckets(100, 2, 8), // 100, 200, 400, 800, etc.
		},
	)

	memoryUsage := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "memory_usage_bytes",
			Help: "Current memory usage in bytes.",
		},
	)

	// Register metrics with Prometheus
	reg.MustRegister(httpRequestsTotal)
	reg.MustRegister(httpRequestDuration)
	reg.MustRegister(responseSize)
	reg.MustRegister(memoryUsage)

	// Simulate activity in a goroutine
	go simulateActivity(httpRequestsTotal, httpRequestDuration, responseSize, memoryUsage)

	// Create a custom handler that explicitly includes bucket metrics
	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		handler := promhttp.HandlerFor(reg, promhttp.HandlerOpts{
			EnableOpenMetrics: true,
		})
		handler.ServeHTTP(w, r)
	})

	// Option 1: Using WithDashboardJSON with inline JSON string
	jsonConfig := `[
		[
			{"name": "memory_usage_bytes", "short": "MEM"},
			{"name": "http_requests_total", "short": "REQS"}
		],
		[
			{"name": "http_request_duration_seconds", "short": "LATENCY"},
			{"name": "http_response_size_bytes", "short": "SIZE"}
		]
	]`

	// Set up a separate server for Prometheus metrics
	go func() {
		log.Println("Starting Prometheus metrics server on :9090/metrics")
		err := http.ListenAndServe(":9090", nil)
		if err != nil {
			log.Printf("Metrics server error: %v", err)
		}
	}()

	// Start the prommy server with custom registry and dashboard
	log.Println("Starting Prommy server on :8082")
	log.Println("The grid view now shows minimalistic histograms for histogram type metrics")
	log.Println("You can also see raw metrics at http://localhost:9090/metrics")
	if err := prommy.Serve(":8082",
		prommy.WithRegistry(reg),
		prommy.WithDashboardJSON(jsonConfig),
	); err != nil {
		log.Fatalf("Error starting server: %v", err)
	}
}

// verifyHistogramBuckets checks if histogram metrics have bucket data
func verifyHistogramBuckets(reg *prometheus.Registry) {
	mfs, err := reg.Gather()
	if err != nil {
		log.Printf("Error gathering metrics: %v", err)
		return
	}

	// Just count the histograms and their buckets silently
	histogramCount := 0
	bucketCount := 0

	for _, mf := range mfs {
		if mf.GetType() == dto.MetricType_HISTOGRAM {
			histogramCount++

			for _, m := range mf.GetMetric() {
				hist := m.GetHistogram()
				if hist != nil {
					bucketCount += len(hist.GetBucket())
				}
			}
		}
	}

	log.Printf("Verified %d histograms with %d total buckets", histogramCount, bucketCount)
}

func simulateActivity(httpRequests *prometheus.CounterVec, requestDuration *prometheus.HistogramVec, responseSize prometheus.Histogram, memoryUsage prometheus.Gauge) {
	// Seed the random number generator
	rand.Seed(time.Now().UnixNano())

	// HTTP status codes and methods for simulation
	statusCodes := []string{"200", "404", "500", "302", "403"}
	methods := []string{"GET", "POST", "PUT", "DELETE"}
	handlers := []string{"api", "static", "metrics", "auth"}

	// Simulate activity every 500ms
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	// Initial memory usage
	memoryValue := 100 * 1024 * 1024 // 100 MB

	for range ticker.C {
		// Simulate HTTP requests
		for i := 0; i < rand.Intn(5)+1; i++ {
			code := statusCodes[rand.Intn(len(statusCodes))]
			method := methods[rand.Intn(len(methods))]
			httpRequests.WithLabelValues(code, method).Inc()
		}

		// Simulate request durations with a realistic distribution
		for i := 0; i < rand.Intn(3)+1; i++ {
			handler := handlers[rand.Intn(len(handlers))]
			method := methods[rand.Intn(len(methods))]

			// Generate a more interesting distribution for the histogram
			// Use an exponential-like distribution with occasional outliers
			var duration float64
			if rand.Float64() < 0.8 {
				// Normal latency around 0.1-0.5 seconds
				duration = 0.1 + rand.Float64()*0.4
			} else if rand.Float64() < 0.95 {
				// Slower requests around 0.5-1.5 seconds
				duration = 0.5 + rand.Float64()
			} else {
				// Occasional very slow requests 1.5-3 seconds
				duration = 1.5 + rand.Float64()*1.5
			}

			requestDuration.WithLabelValues(handler, method).Observe(duration)
		}

		// Simulate response sizes with a different distribution
		for i := 0; i < rand.Intn(2)+1; i++ {
			// Generate a more bimodal distribution for response sizes
			var size float64
			if rand.Float64() < 0.6 {
				// Small responses (100-300 bytes)
				size = 100 + rand.Float64()*200
			} else if rand.Float64() < 0.9 {
				// Medium responses (500-1500 bytes)
				size = 500 + rand.Float64()*1000
			} else {
				// Large responses (2000-8000 bytes)
				size = 2000 + rand.Float64()*6000
			}

			responseSize.Observe(size)
		}

		// Simulate memory usage fluctuations
		change := (rand.Float64() * 20) - 10 // -10 to +10 MB
		memoryValue += int(change * 1024 * 1024)
		if memoryValue < 50*1024*1024 {
			memoryValue = 50 * 1024 * 1024 // Min 50 MB
		}
		memoryUsage.Set(float64(memoryValue))
	}
}
