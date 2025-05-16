package prommy

import (
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Maximum number of allowed WebSocket connections
	maxConnections = 64
)

// Hub manages WebSocket connections and broadcasts metrics updates.
type Hub struct {
	// Registered clients
	clients map[*Client]bool

	// Message broadcast channel
	broadcast chan []byte

	// Register requests from clients
	register chan *Client

	// Unregister requests from clients
	unregister chan *Client

	// Mutex to protect clients map
	mu sync.Mutex
}

// Client represents a connected WebSocket client.
type Client struct {
	// The hub instance
	hub *Hub

	// The WebSocket connection
	conn *websocket.Conn

	// Buffered channel of outbound messages
	send chan []byte
}

// newHub creates a new hub instance and starts its run loop.
func newHub() *Hub {
	h := &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
	go h.run()
	return h
}

// run starts the hub's event loop.
func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			// Check if we're at connection limit
			if len(h.clients) >= maxConnections {
				h.mu.Unlock()
				client.conn.WriteControl(
					websocket.CloseMessage,
					websocket.FormatCloseMessage(1013, "Maximum connections reached, try again later"),
					time.Now().Add(time.Second),
				)
				client.conn.Close()
				continue
			}
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				select {
				case client.send <- message:
					// Message sent to client
				default:
					// Client is slow or disconnected, skip this message and close
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

// Broadcast sends a message to all connected clients.
func (h *Hub) Broadcast(message []byte) {
	h.broadcast <- message
}

// ServeWebSocket handles WebSocket connections for a client.
func (h *Hub) ServeWebSocket(conn *websocket.Conn) {
	client := &Client{
		hub:  h,
		conn: conn,
		send: make(chan []byte, 256),
	}

	// Register client
	h.register <- client

	// Start writer goroutine
	go client.writePump()
}

// writePump pumps messages from the hub to the WebSocket connection.
func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
		c.hub.unregister <- c
	}()

	for message := range c.send {
		err := c.conn.WriteMessage(websocket.TextMessage, message)
		if err != nil {
			log.Printf("Error writing to WebSocket: %v", err)
			return
		}
	}
}
