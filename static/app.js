document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const metricsTable = document.getElementById('metrics-table');
    const filterInput = document.getElementById('filter-input');
    const refreshInterval = document.getElementById('refresh-interval');
    const refreshValue = document.getElementById('refresh-value');
    const timeWindow = document.getElementById('time-window');
    const togglePause = document.getElementById('toggle-pause');
    const toggleView = document.getElementById('toggle-view');
    const tableView = document.getElementById('table-view');
    const gridView = document.getElementById('grid-view');
    const board = document.getElementById('board');
    const connectionStatus = document.getElementById('connection-status');
    const tableHeaders = document.querySelectorAll('th[data-sort]');
    const customizeDashboard = document.getElementById('customize-dashboard');
    const dashboardModal = document.getElementById('dashboard-modal');
    const closeModal = document.querySelector('.close-modal');
    const addRowButton = document.getElementById('add-row');
    const saveLayoutButton = document.getElementById('save-layout');
    const resetLayoutButton = document.getElementById('reset-layout');
    const layoutEditor = document.getElementById('layout-editor');
    const metricSearch = document.getElementById('metric-search');
    const metricsList = document.getElementById('metrics-list');
    const metricTooltip = document.getElementById('metric-tooltip');
    const toggleTheme = document.getElementById('toggle-theme');
    const lightIcon = document.getElementById('light-icon');
    const darkIcon = document.getElementById('dark-icon');
    
    // State
    let isPaused = false;
    let isGridView = true; // Default to grid view
    let isDarkMode = false; // Will be set by checkThemeFromURLHash()
    let metrics = [];
    let allMetricNames = new Set(); // Store all unique metric names
    let filterText = '';
    let interval = parseInt(refreshInterval.value, 10);
    let timeWindowMs = parseInt(timeWindow.value, 10);
    let dashboardLayout = [];
    let metricTiles = new Map(); // Maps metric name to tile element
    let lastValues = new Map(); // Maps metric name to its last value for comparison
    let metricHistory = new Map(); // Maps metric name to array of {timestamp, value} objects
    let sortColumn = 'name'; // Default sort column
    let sortDirection = 'asc'; // Default sort direction
    let customLayout = null; // Store user customized layout
    let isDragging = false;
    let draggedElement = null;
    
    // Constants for line graph
    const MAX_HISTORY_POINTS = 100; // Maximum number of points to store in history
    
    // WebSocket setup
    let ws = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    
    // Check if we're in compact mode
    const isCompactMode = () => window.matchMedia('(max-width: 512px)').matches;
    
    // Check URL hash for theme parameter
    function checkThemeFromURLHash() {
        // First check URL hash for theme parameter
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const urlTheme = hashParams.get('theme');
        
        if (urlTheme === 'dark') {
            isDarkMode = true;
        } else if (urlTheme === 'light') {
            isDarkMode = false;
        } else {
            // If not specified in URL, use localStorage
            isDarkMode = localStorage.getItem('darkMode') === 'true';
        }
    }
    
    // Update the URL hash with current theme
    function updateThemeInURLHash() {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        hashParams.set('theme', isDarkMode ? 'dark' : 'light');
        
        // Preserve other hash parameters
        window.location.hash = hashParams.toString();
    }
    
    // Initialize UI state
    function initUIState() {
        // Check for theme in URL hash
        checkThemeFromURLHash();
        
        // Apply dark mode if needed
        if (isDarkMode) {
            document.body.classList.add('dark-mode');
            lightIcon.style.display = 'none';
            darkIcon.style.display = 'block';
        } else {
            document.body.classList.remove('dark-mode');
            lightIcon.style.display = 'block';
            darkIcon.style.display = 'none';
        }
        
        // Check if we're on a small screen where table view is hidden
        if (isCompactMode()) {
            // On small screens, we only show grid view
            isGridView = true;
            gridView.style.display = 'block';
            tableView.style.display = 'none';
            toggleView.style.display = 'none';
        } else {
            // On larger screens, always ensure the toggle button is visible
            toggleView.style.display = 'inline-block';
            
            // Set appropriate view mode
            if (isGridView) {
                gridView.style.display = 'block';
                tableView.style.display = 'none';
                toggleView.textContent = 'Table';
                toggleView.className = 'button button-gray';
            } else {
                tableView.style.display = 'block';
                gridView.style.display = 'none';
                toggleView.textContent = 'Grid';
                toggleView.className = 'button button-blue';
            }
        }
    }
    
    // Initialize the WebSocket connection
    function connectWebSocket() {
        // Close existing connection if any
        if (ws) {
            ws.close();
        }
        
        // Calculate WebSocket URL based on current location
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${location.host}/ws`;
        
        // Create new WebSocket connection
        ws = new WebSocket(wsUrl);
        
        // Connection opened
        ws.addEventListener('open', () => {
            showConnectionStatus('Connected', 'bg-green');
            setTimeout(() => {
                connectionStatus.style.opacity = '0';
            }, 2000);
            reconnectAttempts = 0;
        });
        
        // Connection closed
        ws.addEventListener('close', (event) => {
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                const delay = Math.min(1000 * reconnectAttempts, 5000);
                showConnectionStatus(`Reconnecting (${reconnectAttempts}/${maxReconnectAttempts})...`, 'bg-yellow');
                
                // Schedule reconnection
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(connectWebSocket, delay);
            } else {
                showConnectionStatus('Connection failed. Refresh the page to retry.', 'bg-red');
            }
        });
        
        // Handle errors
        ws.addEventListener('error', (error) => {
            console.error('WebSocket error:', error);
            showConnectionStatus('Connection error', 'bg-red');
        });
        
        // Handle incoming messages
        ws.addEventListener('message', (event) => {
            if (isPaused) return;
            
            try {
                // Save relevant scroll positions
                const windowScrollPosition = window.scrollY;
                const tableContainer = document.getElementById('table-view');
                const tableScrollPosition = tableContainer ? tableContainer.scrollTop : 0;
                
                metrics = JSON.parse(event.data);
                console.log('Received metrics:', metrics.length);
                
                // Update available metrics list
                updateAvailableMetricsList();
                
                if (isGridView) {
                    updateDashboard();
                    // Restore window scroll for grid view
                    window.scrollTo({
                        top: windowScrollPosition,
                        behavior: 'auto'
                    });
                } else {
                    // Table view - renderMetrics handles its own scroll position
                    renderMetrics();
                }
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        });
    }
    
    // Update the list of available metrics for the customization modal
    function updateAvailableMetricsList() {
        // Skip if the metrics list container doesn't exist
        if (!metricsList) return;
        
        // Extract unique base metric names (remove _sum, _count, _bucket suffixes)
        const baseMetricNames = new Set();
        const metricTypes = new Map(); // Map metric name to its type
        
        metrics.forEach(metric => {
            // Store the original metric name
            allMetricNames.add(metric.name);
            
            // Extract base name without suffixes
            let baseName = metric.name.replace(/_sum$|_count$|_bucket$/, '');
            baseMetricNames.add(baseName);
            
            // Store the metric type
            metricTypes.set(baseName, metric.type);
            metricTypes.set(metric.name, metric.type);
        });
        
        // Only rebuild the metrics list if the modal is visible
        if (dashboardModal.style.display === 'block') {
            // Get the current filter text
            const filterValue = metricSearch.value.toLowerCase();
            
            // Clear the list
            metricsList.innerHTML = '';
            
            // Add each metric to the list
            Array.from(baseMetricNames)
                .sort()
                .filter(name => name.toLowerCase().includes(filterValue))
                .forEach(name => {
                    const item = document.createElement('div');
                    item.className = 'metric-item';
                    item.dataset.metricName = name;
                    
                    // Create type badge
                    const type = metricTypes.get(name) || 'unknown';
                    const typeSpan = document.createElement('span');
                    typeSpan.className = `metric-type metric-type-${type}`;
                    typeSpan.textContent = type.charAt(0).toUpperCase();
                    
                    item.appendChild(typeSpan);
                    item.appendChild(document.createTextNode(name));
                    
                    // Add drag start event
                    item.draggable = true;
                    item.addEventListener('dragstart', (e) => {
                        e.dataTransfer.setData('text/plain', name);
                        isDragging = true;
                        draggedElement = item;
                        item.classList.add('dragging');
                    });
                    
                    item.addEventListener('dragend', () => {
                        isDragging = false;
                        draggedElement = null;
                        item.classList.remove('dragging');
                    });
                    
                    // Add click event (for mobile support)
                    item.addEventListener('click', () => {
                        // Find the first empty cell and populate it
                        const emptyCells = document.querySelectorAll('.layout-cell.empty');
                        if (emptyCells.length > 0) {
                            const cell = emptyCells[0];
                            populateCell(cell, name);
                        }
                    });
                    
                    metricsList.appendChild(item);
                });
        }
    }
    
    // Show connection status
    function showConnectionStatus(message, bgColor) {
        connectionStatus.textContent = message;
        connectionStatus.style.opacity = '1';
        
        // Set appropriate background color
        connectionStatus.style.backgroundColor = bgColor === 'bg-green' ? 'var(--success-bg)' :
            bgColor === 'bg-yellow' ? 'var(--warning-bg)' :
            bgColor === 'bg-red' ? 'var(--error-bg)' : 'var(--warning-bg)';
        
        connectionStatus.style.color = bgColor === 'bg-green' ? 'var(--success-text)' :
            bgColor === 'bg-yellow' ? 'var(--warning-text)' :
            bgColor === 'bg-red' ? 'var(--error-text)' : 'var(--warning-text)';
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            connectionStatus.style.opacity = '0';
        }, 3000);
    }
    
    // Fetch dashboard layout from server or local storage
    async function fetchDashboard() {
        try {
            // First check if we have a stored custom layout
            if (localStorage.getItem('customDashboard')) {
                try {
                    customLayout = JSON.parse(localStorage.getItem('customDashboard'));
                    console.log('Using saved custom dashboard layout');
                    dashboardLayout = customLayout;
                    setupDashboard();
                    return true;
                } catch (error) {
                    console.error('Error parsing saved layout, falling back to server layout', error);
                    localStorage.removeItem('customDashboard');
                }
            }
            
            // If no custom layout, fetch from server
            const response = await fetch('/dashboard');
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            dashboardLayout = await response.json();
            console.log('Fetched dashboard layout from server:', dashboardLayout);
            setupDashboard();
            return true;
        } catch (error) {
            console.error('Error fetching dashboard:', error);
            // Fallback to empty layout
            dashboardLayout = [];
            board.innerHTML = '<div style="grid-column: 1 / -1; grid-row: 1 / -1; display: flex; align-items: center; justify-content: center; color: var(--text-light);">Error loading dashboard</div>';
            return false;
        }
    }
    
    // Setup the dashboard grid based on the layout
    function setupDashboard() {
        // Clear existing content
        board.innerHTML = '';
        metricTiles.clear();
        lastValues.clear();
        
        if (!dashboardLayout || dashboardLayout.length === 0) {
            board.innerHTML = '<div style="grid-column: 1 / -1; grid-row: 1 / -1; display: flex; align-items: center; justify-content: center; color: var(--text-light);">No dashboard layout available</div>';
            return;
        }
        
        // Set grid template based on layout
        const rows = dashboardLayout.length;
        const cols = Math.max(...dashboardLayout.map(row => row.length || 0));
        
        if (rows === 0 || cols === 0) {
            board.innerHTML = '<div style="grid-column: 1 / -1; grid-row: 1 / -1; display: flex; align-items: center; justify-content: center; color: var(--text-light);">Empty dashboard layout</div>';
            return;
        }
        
        board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        
        // Create tiles for each metric in the layout
        dashboardLayout.forEach((row, rowIndex) => {
            if (!Array.isArray(row)) return;
            
            row.forEach((item, colIndex) => {
                // Skip empty items
                if (!item) return;
                
                // Handle both formats: string or {name, short} object
                let metricName;
                let shortName;
                
                if (typeof item === 'string') {
                    // Legacy format - just the metric name as a string
                    metricName = item;
                    // Default short label
                    shortName = metricName.split('_').pop() || metricName.substring(0, 10);
                } else if (typeof item === 'object' && item.name) {
                    // New format with custom short name
                    metricName = item.name;
                    // Use custom short name if provided, otherwise use default
                    shortName = item.short || metricName.split('_').pop() || metricName.substring(0, 10);
                } else {
                    // Invalid format, skip this item
                    return;
                }
                
                // Add support for both base metric name and _count/_sum variations
                const baseMetricName = metricName.replace(/_sum$|_count$/, '');
                
                const tile = document.createElement('div');
                tile.className = 'metric-tile';
                tile.title = metricName; // Full metric name on hover
                tile.dataset.metricName = metricName; // Store the original metric name
                tile.dataset.baseMetricName = baseMetricName; // Store the base metric name
                
                // Explicitly position the tile in the grid
                tile.style.gridRow = `${rowIndex + 1}`;
                tile.style.gridColumn = `${colIndex + 1}`;
                
                const value = document.createElement('div');
                value.className = 'value';
                value.textContent = '...';
                
                const label = document.createElement('div');
                label.className = 'label';
                label.textContent = shortName;
                
                tile.appendChild(value);
                tile.appendChild(label);
                
                board.appendChild(tile);
                
                // Map both the exact metric name and variations to this tile
                metricTiles.set(metricName, tile);
                if (metricName !== baseMetricName) {
                    metricTiles.set(baseMetricName, tile);
                }
                if (metricName.endsWith('_sum')) {
                    metricTiles.set(baseMetricName + '_sum', tile);
                } else if (metricName.endsWith('_count')) {
                    metricTiles.set(baseMetricName + '_count', tile);
                } else {
                    // Add mapping for both sum and count variations
                    metricTiles.set(metricName + '_sum', tile);
                    metricTiles.set(metricName + '_count', tile);
                }
                
                // Initialize last values
                lastValues.set(metricName, null);
            });
        });
    }
    
    // Create layout for editor based on current dashboard
    function setupLayoutEditor() {
        // Clear existing content
        layoutEditor.innerHTML = '';
        
        // If no dashboard layout or empty, add a default row
        if (!dashboardLayout || dashboardLayout.length === 0) {
            addEditorRow();
            return;
        }
        
        // Create rows for each row in the dashboard layout
        dashboardLayout.forEach((rowData, rowIndex) => {
            const row = createEditorRow();
            
            // If rowData is not an array or empty, add an empty cell
            if (!Array.isArray(rowData) || rowData.length === 0) {
                const cell = createEditorCell(null);
                row.appendChild(cell);
            } else {
                // Add cells for each item in the row
                rowData.forEach((item, colIndex) => {
                    // Handle different formats of item (string or object)
                    let metricName = null;
                    if (typeof item === 'string') {
                        metricName = item;
                    } else if (item && typeof item === 'object' && item.name) {
                        metricName = item.name;
                    }
                    
                    const cell = createEditorCell(metricName);
                    row.appendChild(cell);
                });
            }
            
            layoutEditor.appendChild(row);
        });
    }
    
    // Create a new row for the layout editor
    function createEditorRow() {
        const row = document.createElement('div');
        row.className = 'layout-row';
        
        // Add row actions
        const actions = document.createElement('div');
        actions.className = 'row-actions';
        
        // Add cell button
        const addCellBtn = document.createElement('button');
        addCellBtn.className = 'action-button';
        addCellBtn.innerHTML = '+';
        addCellBtn.title = 'Add Cell';
        addCellBtn.addEventListener('click', () => {
            const cell = createEditorCell(null);
            row.appendChild(cell);
        });
        
        // Remove row button
        const removeRowBtn = document.createElement('button');
        removeRowBtn.className = 'action-button';
        removeRowBtn.innerHTML = '×';
        removeRowBtn.title = 'Remove Row';
        removeRowBtn.addEventListener('click', () => {
            row.remove();
        });
        
        actions.appendChild(addCellBtn);
        actions.appendChild(removeRowBtn);
        row.appendChild(actions);
        
        // Make the row a drop target for cells
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (isDragging) {
                row.classList.add('drag-over');
            }
        });
        
        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over');
        });
        
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over');
            
            const metricName = e.dataTransfer.getData('text/plain');
            
            // If dropped directly on the row, add a new cell with this metric
            if (e.target === row) {
                const cell = createEditorCell(metricName);
                row.appendChild(cell);
            }
        });
        
        return row;
    }
    
    // Create a new cell for the layout editor
    function createEditorCell(metricName) {
        const cell = document.createElement('div');
        cell.className = 'layout-cell';
        
        if (!metricName) {
            cell.classList.add('empty');
            cell.textContent = 'Drop metric here';
        } else {
            populateCell(cell, metricName);
        }
        
        // Make cell a drop target
        cell.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (isDragging) {
                cell.classList.add('drag-over');
            }
        });
        
        cell.addEventListener('dragleave', () => {
            cell.classList.remove('drag-over');
        });
        
        cell.addEventListener('drop', (e) => {
            e.preventDefault();
            cell.classList.remove('drag-over');
            
            const metricName = e.dataTransfer.getData('text/plain');
            populateCell(cell, metricName);
        });
        
        return cell;
    }
    
    // Populate a cell with metric data
    function populateCell(cell, metricName) {
        // Clear existing content
        cell.innerHTML = '';
        cell.classList.remove('empty');
        cell.dataset.metricName = metricName;
        
        // Create metric display
        const metricDisplay = document.createElement('div');
        metricDisplay.textContent = metricName;
        
        // Create remove button
        const removeBtn = document.createElement('div');
        removeBtn.className = 'remove-metric';
        removeBtn.innerHTML = '×';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cell.innerHTML = 'Drop metric here';
            cell.classList.add('empty');
            delete cell.dataset.metricName;
        });
        
        cell.appendChild(metricDisplay);
        cell.appendChild(removeBtn);
    }
    
    // Add a new row to the layout editor
    function addEditorRow() {
        const row = createEditorRow();
        
        // Add one empty cell to start
        const cell = createEditorCell(null);
        row.appendChild(cell);
        
        layoutEditor.appendChild(row);
    }
    
    // Generate dashboard layout from editor
    function generateLayoutFromEditor() {
        const newLayout = [];
        
        // Process each row
        Array.from(layoutEditor.children).forEach(rowElement => {
            const rowData = [];
            
            // Process each cell in the row
            Array.from(rowElement.querySelectorAll('.layout-cell')).forEach(cellElement => {
                if (cellElement.dataset.metricName) {
                    // Use object format with name field
                    rowData.push({
                        name: cellElement.dataset.metricName,
                        short: cellElement.dataset.metricName.split('_').pop() || cellElement.dataset.metricName.substring(0, 10)
                    });
                } else {
                    // Empty cell
                    rowData.push(null);
                }
            });
            
            // Only add rows that have at least one non-null cell
            if (rowData.some(cell => cell !== null)) {
                newLayout.push(rowData);
            }
        });
        
        return newLayout;
    }
    
    // Save the custom layout
    function saveCustomLayout() {
        const newLayout = generateLayoutFromEditor();
        
        if (newLayout.length === 0 || newLayout.every(row => row.length === 0)) {
            alert('Cannot save an empty dashboard. Please add at least one metric.');
            return;
        }
        
        // Save to localStorage
        localStorage.setItem('customDashboard', JSON.stringify(newLayout));
        
        // Update the dashboard
        customLayout = newLayout;
        dashboardLayout = newLayout;
        
        // Rebuild the dashboard
        setupDashboard();
        updateDashboard();
        
        // Close the modal
        dashboardModal.style.display = 'none';
        
        // Show confirmation
        showConnectionStatus('Dashboard layout saved', 'bg-green');
    }
    
    // Reset to default layout
    function resetToDefaultLayout() {
        // Confirm reset
        if (!confirm('Are you sure you want to reset to the default layout? Your custom layout will be lost.')) {
            return;
        }
        
        // Remove stored layout
        localStorage.removeItem('customDashboard');
        customLayout = null;
        
        // Re-fetch default layout from server
        fetchDashboard().then(() => {
            // Close the modal
            dashboardModal.style.display = 'none';
            
            // Show confirmation
            showConnectionStatus('Reset to default layout', 'bg-green');
        });
    }
    
    // Remove the highlight class after animation completes
    function removeHighlight(element) {
        element.classList.remove('highlight');
    }
    
    // Find the best matching metric for a given tile
    function findMatchingMetric(metricName) {
        // First, try exact match
        const exactMatch = metrics.find(m => m.name === metricName);
        if (exactMatch) return exactMatch;
        
        // Try removing _sum or _count suffix for base metrics
        if (metricName.endsWith('_sum') || metricName.endsWith('_count')) {
            const baseMetricName = metricName.replace(/_sum$|_count$/, '');
            return metrics.find(m => m.name === baseMetricName);
        }
        
        // For base metrics, try with _sum suffix (preferred) or _count
        const sumMetric = metrics.find(m => m.name === `${metricName}_sum`);
        if (sumMetric) return sumMetric;
        
        const countMetric = metrics.find(m => m.name === `${metricName}_count`);
        if (countMetric) return countMetric;
        
        return null;
    }
    
    // Generate histogram data for a metric if it's a histogram type
    function generateHistogramData(metricName) {
        console.log(`Looking for bucket metrics for ${metricName}`);
        
        // First check for direct _bucket metrics
        let bucketMetrics = metrics.filter(m => 
            m.name.startsWith(metricName + "_bucket") && 
            m.labels && 
            m.labels.le !== undefined
        );
        
        // If no direct bucket metrics, try to find the base name for a histogram
        if (bucketMetrics.length === 0) {
            // Strip off _sum or _count suffixes if present
            const baseMetricName = metricName.replace(/_(sum|count)$/, '');
            
            console.log(`Checking base metric name ${baseMetricName} for buckets`);
            
            bucketMetrics = metrics.filter(m => 
                m.name.startsWith(baseMetricName + "_bucket") && 
                m.labels && 
                m.labels.le !== undefined
            );
            
            if (bucketMetrics.length === 0) {
                // If the metric is already missing the _sum or _count suffix,
                // check for a histogram with this name as a prefix
                const potentialBaseMetrics = metrics.filter(m => 
                    m.name.includes("_bucket") && 
                    m.labels && 
                    m.labels.le !== undefined
                );
                
                console.log(`Checked ${potentialBaseMetrics.length} potential metrics for bucket data`);
                
                // Get all unique base names from bucket metrics
                const baseNames = new Set();
                potentialBaseMetrics.forEach(m => {
                    const base = m.name.replace(/_bucket.*$/, '');
                    baseNames.add(base);
                });
                
                console.log(`Found potential base names:`, Array.from(baseNames));
                
                // Check if our metric name is a prefix or matches any base name
                for (const baseName of baseNames) {
                    if (baseName === metricName || metricName.startsWith(baseName)) {
                        bucketMetrics = metrics.filter(m => 
                            m.name.startsWith(baseName + "_bucket") && 
                            m.labels && 
                            m.labels.le !== undefined
                        );
                        if (bucketMetrics.length > 0) {
                            console.log(`Found ${bucketMetrics.length} buckets for base name ${baseName}`);
                            break;
                        }
                    }
                }
            }
        }
        
        if (bucketMetrics.length === 0) {
            console.log(`No bucket metrics found for ${metricName}`);
            return null; // Not a histogram or no bucket data
        }
        
        console.log(`Found ${bucketMetrics.length} bucket metrics for ${metricName}`);
        
        // Sort buckets by their upper limit
        const sortedBuckets = bucketMetrics.sort((a, b) => {
            const aLimit = parseFloat(a.labels.le);
            const bLimit = parseFloat(b.labels.le);
            return aLimit - bLimit;
        });
        
        // Get bucket values, excluding infinity bucket at the end if present
        const bucketValues = sortedBuckets
            .filter(b => b.labels.le !== "+Inf")
            .map(b => b.value);
        
        // Calculate differences between adjacent buckets to get the histogram bars
        const histogramData = [];
        let prevValue = 0;
        
        for (let i = 0; i < bucketValues.length; i++) {
            const value = bucketValues[i] - prevValue;
            histogramData.push(value);
            prevValue = bucketValues[i];
        }
        
        // Print the histogram data
        console.log("Histogram data:", histogramData);
        
        return histogramData;
    }
    
    // Update dashboard tiles with current metric values
    function updateDashboard() {
        if (!metrics || metrics.length === 0) {
            console.log("No metrics to display");
            return;
        }
        
        // Apply filter if set
        const filteredMetrics = filterMetrics(metrics);
        
        // Debug all metric names we have
        if (filteredMetrics.length > 0 && metricTiles.size > 0) {
            console.log("Available metrics:", filteredMetrics.map(m => m.name));
            console.log("Dashboard metrics:", Array.from(metricTiles.keys()));
        }
        
        // First, reset all tiles to show they're not matched by the filter
        if (filterText) {
            metricTiles.forEach((tile, metricName) => {
                // Add faded class to all tiles initially
                tile.classList.add('faded');
            });
        } else {
            // If no filter, ensure no tiles are faded
            metricTiles.forEach((tile) => {
                tile.classList.remove('faded');
            });
        }
        
        // Loop through filtered metrics to find ones that match our dashboard
        filteredMetrics.forEach(metric => {
            const tile = metricTiles.get(metric.name);
            if (tile) {
                // If this metric passes the filter, make sure it's not faded
                tile.classList.remove('faded');
                updateTile(tile, metric);
            }
        });
        
        // Second pass for metrics that didn't have direct matches
        if (!filterText) {  // Only do this when not filtering
            metricTiles.forEach((tile, metricName) => {
                const valueEl = tile.querySelector('.value');
                if (valueEl && valueEl.textContent === '...') {
                    const matchingMetric = findMatchingMetric(metricName);
                    if (matchingMetric) {
                        updateTile(tile, matchingMetric);
                    }
                }
            });
        }
    }
    
    // Filter metrics based on search text
    function filterMetrics(metricsList) {
        if (!filterText) return metricsList;
        
        return metricsList.filter(metric => {
            const regex = new RegExp(filterText, 'i');
            return regex.test(metric.name) || 
                   regex.test(metric.type) || 
                   (metric.labels && Object.entries(metric.labels).some(([k, v]) => regex.test(`${k}=${v}`)));
        });
    }
    
    // Sort metrics based on current sort settings
    function sortMetrics(metricsList) {
        return [...metricsList].sort((a, b) => {
            let result = 0;
            
            // Determine how to compare based on sort column
            switch (sortColumn) {
                case 'name':
                    // Case-insensitive string comparison
                    result = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                    
                    // If names are equal, sort by labels for stability
                    if (result === 0) {
                        const aLabelsStr = a.labels ? Object.entries(a.labels).sort().join('') : '';
                        const bLabelsStr = b.labels ? Object.entries(b.labels).sort().join('') : '';
                        result = aLabelsStr.localeCompare(bLabelsStr);
                    }
                    break;
                    
                case 'type':
                    // Simple string comparison for type
                    result = a.type.localeCompare(b.type);
                    // If types are equal, sort by name and then labels
                    if (result === 0) {
                        result = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                        
                        if (result === 0) {
                            const aLabelsStr = a.labels ? Object.entries(a.labels).sort().join('') : '';
                            const bLabelsStr = b.labels ? Object.entries(b.labels).sort().join('') : '';
                            result = aLabelsStr.localeCompare(bLabelsStr);
                        }
                    }
                    break;
                    
                case 'labels':
                    // First compare by number of labels
                    const aLabelsCount = a.labels ? Object.keys(a.labels).length : 0;
                    const bLabelsCount = b.labels ? Object.keys(b.labels).length : 0;
                    
                    result = aLabelsCount - bLabelsCount;
                    
                    // If label counts are equal, compare actual label content
                    if (result === 0) {
                        const aLabelsStr = a.labels ? Object.entries(a.labels).sort().join('') : '';
                        const bLabelsStr = b.labels ? Object.entries(b.labels).sort().join('') : '';
                        result = aLabelsStr.localeCompare(bLabelsStr);
                        
                        // If labels are equal, sort by name
                        if (result === 0) {
                            result = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                        }
                    }
                    break;
                    
                case 'value':
                    // Numeric comparison for values
                    result = a.value - b.value;
                    // If values are equal, sort by name and then labels
                    if (result === 0) {
                        result = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                        
                        if (result === 0) {
                            const aLabelsStr = a.labels ? Object.entries(a.labels).sort().join('') : '';
                            const bLabelsStr = b.labels ? Object.entries(b.labels).sort().join('') : '';
                            result = aLabelsStr.localeCompare(bLabelsStr);
                        }
                    }
                    break;
                    
                default:
                    // Default to name+labels sorting
                    result = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                    if (result === 0) {
                        const aLabelsStr = a.labels ? Object.entries(a.labels).sort().join('') : '';
                        const bLabelsStr = b.labels ? Object.entries(b.labels).sort().join('') : '';
                        result = aLabelsStr.localeCompare(bLabelsStr);
                    }
            }
            
            // Apply sort direction
            return sortDirection === 'asc' ? result : -result;
        });
    }
    
    // Update sort indicators in table headers
    function updateSortIndicators() {
        tableHeaders.forEach(header => {
            const headerSort = header.getAttribute('data-sort');
            header.classList.remove('sort-asc', 'sort-desc');
            
            if (headerSort === sortColumn) {
                header.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }
    
    // Update a single tile with metric data
    function updateTile(tile, metric) {
        const valueEl = tile.querySelector('.value');
        if (!valueEl) return;
        
        const newValue = formatValue(metric.value, metric.name);
        const metricName = tile.dataset.metricName;
        const lastValue = lastValues.get(metricName);
        
        // Set tooltip data for this tile
        tile.dataset.metricType = metric.type;
        tile.dataset.metricValue = metric.value;
        tile.dataset.metricHelp = metric.help || '';
        
        // Store labels as JSON in dataset for tooltip
        if (metric.labels && Object.keys(metric.labels).length > 0) {
            tile.dataset.metricLabels = JSON.stringify(metric.labels);
        } else {
            delete tile.dataset.metricLabels;
        }
        
        // Update metric history for line graphs (only for gauges and counters)
        if (metric.type === 'gauge' || metric.type === 'counter') {
            updateMetricHistory(metricName, metric.value);
            renderLineGraph(tile, metricName, metric.type);
        } else {
            // Remove line graph if metric type changed
            const lineGraphBg = tile.querySelector('.line-graph-bg');
            if (lineGraphBg) {
                lineGraphBg.remove();
            }
        }
        
        // Check for histogram-type metrics by looking for bucket metrics
        const isHistogram = isHistogramMetric(metricName, metric);
        
        // Handle histogram background if needed
        if (isHistogram) {
            // Find all bucket metrics for this histogram
            const bucketData = getHistogramBuckets(metricName);
            
            // Create or update histogram visualization
            if (bucketData && bucketData.length > 1) {
                renderHistogramBackground(tile, bucketData);
            }
        } else {
            // Remove histogram background if this is not a histogram
            const histogramBg = tile.querySelector('.histogram-bg');
            if (histogramBg) {
                histogramBg.remove();
            }
        }
        
        // Only update and animate if the value changed
        if (lastValue !== null && lastValue !== newValue) {
            // Directly update the text without animation
            valueEl.textContent = newValue;
            
            // Apply background highlight animation
            tile.classList.remove('highlight'); // Remove in case it's still there
            
            // Force a reflow to restart the animation
            void tile.offsetWidth;
            
            // Add the highlight class to trigger the animation
            tile.classList.add('highlight');
        } else if (lastValue === null) {
            // Initial value, just set it without animation
            valueEl.textContent = newValue;
        }
        
        // Update last value
        lastValues.set(metricName, newValue);
        
        // Add tooltip event listeners if not already added
        if (!tile.dataset.tooltipInitialized) {
            tile.addEventListener('mouseenter', showTooltip);
            tile.addEventListener('mouseleave', hideTooltip);
            tile.addEventListener('mousemove', moveTooltip);
            tile.dataset.tooltipInitialized = 'true';
        }
    }
    
    // Show tooltip for metric
    function showTooltip(e) {
        const tile = e.currentTarget;
        const tooltip = document.getElementById('metric-tooltip');
        
        // Store the current tile in a data attribute on the tooltip for later reference
        tooltip.dataset.currentTile = tile.dataset.metricName;
        
        // Get metric data from tile dataset
        const metricName = tile.dataset.metricName;
        const metricType = tile.dataset.metricType || 'unknown';
        const metricValue = tile.dataset.metricValue || '';
        const metricHelp = tile.dataset.metricHelp || '';
        
        // Parse labels if available
        let labels = {};
        if (tile.dataset.metricLabels) {
            try {
                labels = JSON.parse(tile.dataset.metricLabels);
            } catch (error) {
                console.error('Error parsing metric labels:', error);
            }
        }
        
        // Populate tooltip content
        const titleEl = tooltip.querySelector('.tooltip-title');
        const typeEl = tooltip.querySelector('.tooltip-type');
        const valueEl = tooltip.querySelector('.tooltip-value');
        const labelsEl = tooltip.querySelector('.tooltip-labels');
        const helpEl = tooltip.querySelector('.tooltip-help');
        
        titleEl.textContent = metricName;
        typeEl.textContent = metricType;
        typeEl.className = `tooltip-type ${metricType}`;
        valueEl.textContent = formatValue(parseFloat(metricValue), metricName);
        
        // Format labels
        labelsEl.innerHTML = '';
        if (Object.keys(labels).length > 0) {
            Object.entries(labels).forEach(([key, value]) => {
                const labelEl = document.createElement('div');
                labelEl.className = 'tooltip-label';
                
                const keyEl = document.createElement('span');
                keyEl.className = 'tooltip-label-key';
                keyEl.textContent = `${key}=`;
                
                const valueEl = document.createElement('span');
                valueEl.className = 'tooltip-label-value';
                valueEl.textContent = value;
                
                labelEl.appendChild(keyEl);
                labelEl.appendChild(valueEl);
                labelsEl.appendChild(labelEl);
            });
        } else {
            labelsEl.innerHTML = '<div style="color: var(--text-light); font-style: italic;">No labels</div>';
        }
        
        // Add help text if available
        // Reset originalText for this new tooltip display
        delete helpEl.dataset.originalText;
        
        if (metricHelp) {
            helpEl.textContent = metricHelp;
            helpEl.style.display = 'block';
            // Store the original metric help text
            helpEl.dataset.originalText = metricHelp;
        } else {
            helpEl.textContent = '';
            helpEl.style.display = 'none';
        }
        
        // Check if this element has line graph data
        if (metricType === 'counter' || metricType === 'gauge') {
            // Add additional data point info to the tooltip
            const historyData = metricHistory.get(metricName);
            if (historyData && historyData.length > 0) {
                const minValue = tile.dataset.valueMin;
                const maxValue = tile.dataset.valueMax;
                if (minValue && maxValue) {
                    const rangeText = `Range: ${formatValue(parseFloat(minValue), metricName)} - ${formatValue(parseFloat(maxValue), metricName)}`;
                    
                    // Add the range text to the help text
                    if (helpEl.dataset.originalText) {
                        helpEl.textContent = `${helpEl.dataset.originalText}\n${rangeText}`;
                    } else {
                        helpEl.textContent = rangeText;
                        helpEl.dataset.originalText = '';
                    }
                    helpEl.style.display = 'block';
                }
            }
        }
        
        // Position and show tooltip
        tooltip.style.display = 'block';
        moveTooltip(e);
        
        // Fade in
        setTimeout(() => {
            tooltip.style.opacity = '1';
        }, 10);
    }
    
    // Move tooltip with cursor
    function moveTooltip(e) {
        const tooltip = document.getElementById('metric-tooltip');
        if (tooltip.style.display !== 'block') return;
        
        // Get the tile element - either the event target or a parent
        let tile = e.currentTarget;
        
        // If the event originated from a graph element, find the parent tile
        if (!tile.classList.contains('metric-tile')) {
            tile = e.target.closest('.metric-tile');
            if (!tile) {
                // If we can't find a parent tile, use the current tile from the tooltip
                const currentTileName = tooltip.dataset.currentTile;
                if (currentTileName) {
                    tile = document.querySelector(`.metric-tile[data-metric-name="${currentTileName}"]`);
                }
                
                if (!tile) return; // Safety check - if no tile, don't proceed
            }
        }
        
        // Get cursor position
        const x = e.clientX;
        const y = e.clientY;
        
        // Get window dimensions
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        // Get tooltip dimensions
        const tooltipWidth = tooltip.offsetWidth;
        const tooltipHeight = tooltip.offsetHeight;
        
        // Calculate position to keep tooltip on screen
        let posX = x + 15; // 15px offset from cursor
        let posY = y + 15;
        
        // Adjust if would go off right edge
        if (posX + tooltipWidth > windowWidth - 10) {
            posX = x - tooltipWidth - 15;
        }
        
        // Adjust if would go off bottom edge
        if (posY + tooltipHeight > windowHeight - 10) {
            posY = y - tooltipHeight - 15;
        }
        
        // Keep on screen if cursor is at edge
        posX = Math.max(10, Math.min(windowWidth - tooltipWidth - 10, posX));
        posY = Math.max(10, Math.min(windowHeight - tooltipHeight - 10, posY));
        
        // Set position
        tooltip.style.left = `${posX}px`;
        tooltip.style.top = `${posY}px`;
        
        // Check if we should update the tooltip value based on cursor position
        const metricType = tile.dataset.metricType;
        if ((metricType === 'counter' || metricType === 'gauge') && 
            tooltip.dataset.currentTile === tile.dataset.metricName) {
            updateTooltipValueForGraph(e, tile);
        }
    }
    
    // Hide tooltip
    function hideTooltip() {
        const tooltip = document.getElementById('metric-tooltip');
        tooltip.style.opacity = '0';
        
        // Hide after fade out
        setTimeout(() => {
            tooltip.style.display = 'none';
            tooltip.dataset.currentTile = '';
        }, 200);
    }
    
    // Update tooltip value when hovering over a line graph
    function updateTooltipValueForGraph(e, tile) {
        // Only update for the actively displayed tooltip
        const tooltip = document.getElementById('metric-tooltip');
        if (tooltip.style.display !== 'block' || tooltip.dataset.currentTile !== tile.dataset.metricName) return;
        
        const metricName = tile.dataset.metricName;
        const valueEl = tooltip.querySelector('.tooltip-value');
        const historyData = metricHistory.get(metricName);
        
        if (!historyData || historyData.length < 2) return;
        
        // Get position of mouse relative to the tile
        const tileRect = tile.getBoundingClientRect();
        const relativeX = e.clientX - tileRect.left;
        const tileWidth = tileRect.width;
        
        // Calculate position as a percentage of the tile width
        const positionPercent = relativeX / tileWidth;
        
        // Calculate the time that corresponds to this position
        const now = Date.now();
        const timeWindowMs = parseInt(timeWindow.value, 10);
        const timeAtPosition = now - (timeWindowMs * (1 - positionPercent));
        
        // Find the history data point closest to this time
        const closestPoint = findClosestPointByTime(historyData, timeAtPosition);
        
        // Update the tooltip value if we found a relevant point
        if (closestPoint) {
            valueEl.textContent = formatValue(closestPoint.value, metricName);
        }
    }
    
    // Find history data point closest to a specific time
    function findClosestPointByTime(historyData, targetTime) {
        if (!historyData || historyData.length === 0) return null;
        
        // Sort by time difference to target
        const sorted = [...historyData].sort((a, b) => 
            Math.abs(a.timestamp - targetTime) - Math.abs(b.timestamp - targetTime)
        );
        
        return sorted[0];
    }
    
    // Update metric history for line graphs
    function updateMetricHistory(metricName, value) {
        if (!metricHistory.has(metricName)) {
            metricHistory.set(metricName, []);
        }
        
        const history = metricHistory.get(metricName);
        history.push({
            timestamp: Date.now(),
            value: value
        });
        
        // Limit array size to avoid excessive memory usage
        if (history.length > MAX_HISTORY_POINTS) {
            history.shift(); // Remove oldest value
        }
    }
    
    // Render line graph for gauge and counter metrics
    function renderLineGraph(tile, metricName, metricType) {
        // Get history data
        const history = metricHistory.get(metricName) || [];
        if (history.length < 2) {
            console.log(`Not enough history points for ${metricName}, need at least 2`);
            return; // Need at least 2 points to draw a line
        }
        
        console.log(`Rendering line graph for ${metricName} with ${history.length} points`);
        
        // Get or create line graph background container
        let lineGraphBg = tile.querySelector('.line-graph-bg');
        if (!lineGraphBg) {
            console.log(`Creating new line graph container for ${metricName}`);
            lineGraphBg = document.createElement('div');
            lineGraphBg.className = 'line-graph-bg';
            lineGraphBg.style.zIndex = "0"; // Ensure z-index is set correctly
            
            // Enable pointer events for the graph to capture hover
            lineGraphBg.style.pointerEvents = "auto";
            
            // Add event handling to directly update the tooltip on mouse move
            lineGraphBg.addEventListener('mousemove', (e) => {
                // Only process if the tooltip is visible
                const tooltip = document.getElementById('metric-tooltip');
                if (tooltip.style.display === 'block') {
                    // Get the tile element
                    const tileName = tooltip.dataset.currentTile;
                    if (tileName === metricName) {
                        // Directly update the tooltip value based on mouse position
                        const valueEl = tooltip.querySelector('.tooltip-value');
                        if (valueEl) {
                            // Calculate position as percentage
                            const tileRect = tile.getBoundingClientRect();
                            const relativeX = e.clientX - tileRect.left;
                            const tileWidth = tileRect.width;
                            const positionPercent = relativeX / tileWidth;
                            
                            // Get the value at this position
                            const now = Date.now();
                            const timeWindowMs = parseInt(timeWindow.value, 10);
                            const timeAtPosition = now - (timeWindowMs * (1 - positionPercent));
                            
                            // Find closest data point
                            const closestPoint = findClosestPointByTime(history, timeAtPosition);
                            if (closestPoint) {
                                valueEl.textContent = formatValue(closestPoint.value, metricName);
                            }
                        }
                        
                        // Also update the tooltip position
                        moveTooltip(e);
                    }
                }
            });
            
            // Ensure tooltip shows when hovering over the graph
            lineGraphBg.addEventListener('mouseenter', (e) => {
                if (document.getElementById('metric-tooltip').style.display !== 'block') {
                    // Forward to the tile's mouseenter handler
                    const event = new MouseEvent('mouseenter', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: e.clientX,
                        clientY: e.clientY
                    });
                    tile.dispatchEvent(event);
                }
            });
            
            tile.appendChild(lineGraphBg);
        } else {
            // Clear existing content
            console.log(`Updating existing line graph for ${metricName}`);
            lineGraphBg.innerHTML = '';
        }
        
        // Create SVG element
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("class", "line-graph-svg");
        svg.setAttribute("preserveAspectRatio", "none");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.overflow = "visible";
        
        // Create a style element to apply fill rules to the SVG
        const style = document.createElementNS(svgNS, "style");
        style.textContent = `
            .area-fill {
                fill: var(--green-color);
                fill-opacity: var(--graph-fill-opacity, 0.3);
                stroke: none;
            }
        `;
        svg.appendChild(style);
        
        // Filter data points to the configured time window
        const now = Date.now();
        const cutoffTime = now - timeWindowMs;
        const timeWindowData = history.filter(point => point.timestamp >= cutoffTime);
        
        // If we don't have enough data in the time window, use what we have
        const graphData = timeWindowData.length >= 2 ? timeWindowData : history.slice(-Math.min(history.length, 20));
        
        // Find min and max values for scaling - use improved auto-scaling
        const values = graphData.map(h => h.value);
        let minValue = Math.min(...values);
        let maxValue = Math.max(...values);
        
        // Better auto-scaling for improved visualization
        // If all values are the same, create a small range around the value
        if (minValue === maxValue) {
            // Create a 10% range around the single value (or at least 1 unit if value is very small)
            const range = Math.max(maxValue * 0.1, 1);
            minValue = Math.max(0, minValue - range / 2); // Don't go below 0 for most metrics
            maxValue = maxValue + range / 2;
        } else {
            // Add some padding to the range (5% on top and bottom)
            const range = maxValue - minValue;
            minValue = Math.max(0, minValue - range * 0.05); // Don't go below 0 for most metrics
            maxValue = maxValue + range * 0.05;
            
            // For small ranges or fluctuations, ensure we have at least some meaningful range
            if (range < maxValue * 0.01) {
                minValue = Math.max(0, minValue - maxValue * 0.05);
                maxValue = maxValue + maxValue * 0.05;
            }
        }
        
        // For counters that are monotonically increasing, it's often useful to show
        // the range of changes rather than absolute values
        if (metricType === 'counter' && values.length > 1) {
            // Check if the values are strictly increasing (typical for counters)
            const isStrictlyIncreasing = values.every((val, i) => i === 0 || val >= values[i-1]);
            
            if (isStrictlyIncreasing && maxValue > minValue * 1.01) {
                // For strictly increasing counters with a significant increase,
                // adjust the min value to create a better visualization of the rate of change
                // But only do this if the range isn't already small
                minValue = Math.max(0, maxValue * 0.9);
            }
        }
        
        // Ensure we have a range (even if all values are the same)
        const range = maxValue - minValue || maxValue * 0.1 || 1;
        
        // Calculate point coordinates
        const points = [];
        const width = 100; // Using percentages for SVG viewBox
        // Use only 50% of the height to ensure the visualization stays in the bottom half
        // and leaves space for the metric value and label
        const usableHeight = 50; 
        const bottomPadding = 0; // 10% padding at the bottom
        const topOffset = 50; // Start from 50% down the tile
        
        // Use a scrolling approach - map the entire time window to the width
        if (graphData.length >= 2) {
            // Add newest point which should be at the right edge
            const newestPoint = graphData[graphData.length - 1];
            
            // Make sure we have the current timestamp to position relative to
            const currentTimestamp = now;
            const timeRange = timeWindowMs;
            
            // Calculate x positions based on time since now
            graphData.forEach(point => {
                // Calculate time difference from current time 
                const timeDiff = currentTimestamp - point.timestamp;
                
                // Ensure newest data point is at the far right edge by scaling against full time window
                const percentFromRight = (timeDiff / timeRange) * 100;
                
                // X position starts from right (100%) and moves left
                // Clamp to 0-100 range to ensure all points are visible
                const x = Math.min(100, Math.max(0, 100 - percentFromRight));
                
                // Normalize y to 0-usableHeight% (inverted because SVG y-axis is top-down)
                const rawY = (point.value - minValue) / range;
                // Clamp to 0-1, then scale to usable height (50%)
                const normalizedY = Math.max(0, Math.min(1, rawY));
                // Position in the bottom half with padding
                const y = topOffset + (usableHeight - (normalizedY * usableHeight) - bottomPadding);
                
                points.push([x, y]);
            });
            
            // Ensure the newest point is exactly at the right edge (100%)
            const newestPointIndex = points.findIndex(p => 
                p[0] === Math.max(...points.map(point => point[0]))
            );
            if (newestPointIndex >= 0) {
                points[newestPointIndex][0] = 100;
            }
        } else {
            console.log(`Not enough points to draw line for ${metricName}`);
            return; // Not enough data points
        }
        
        // Sort points by x value (timestamp) to ensure proper line drawing
        points.sort((a, b) => a[0] - b[0]);
        
        // Create path for line
        const pathData = points.map((point, i) => 
            (i === 0 ? "M" : "L") + point[0] + "," + point[1]
        ).join(" ");
        
        // Create path element
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", pathData);
        path.setAttribute("class", "line-graph-svg");
        path.setAttribute("vector-effect", "non-scaling-stroke");
        path.style.stroke = "var(--green-color)"; // Explicitly set stroke
        path.style.strokeWidth = "1.5px"; // Explicitly set stroke width
        path.style.fill = "none"; // Explicitly ensure no fill
        
        // Create area under the line (for filled look)
        // Make sure the area closes at the topOffset + usableHeight - bottomPadding
        const areaPathData = 
            pathData + 
            ` L${points[points.length-1][0]},${topOffset + usableHeight - bottomPadding} L${points[0][0]},${topOffset + usableHeight - bottomPadding} Z`;
        
        const areaPath = document.createElementNS(svgNS, "path");
        areaPath.setAttribute("d", areaPathData);
        areaPath.setAttribute("class", "area-fill");
        // Also set inline styles for maximum compatibility
        areaPath.style.fill = "var(--green-color)";
        areaPath.style.fillOpacity = "var(--graph-fill-opacity, 0.3)";
        areaPath.style.stroke = "none";
        
        // Add elements to SVG
        svg.appendChild(areaPath); // Area first (so it's behind the line)
        svg.appendChild(path); // Line on top
        
        // Add SVG to container
        lineGraphBg.appendChild(svg);
        
        // Store graph data points for tooltip interaction
        tile.dataset.graphData = JSON.stringify(graphData.map(point => ({
            timestamp: point.timestamp,
            value: point.value
        })));
        
        // Add range information to tile for the tooltip
        tile.dataset.valueMin = minValue;
        tile.dataset.valueMax = maxValue;
        
        console.log(`Line graph rendered for ${metricName}`);
    }
    
    // Check if a metric is a histogram type
    function isHistogramMetric(name, metric) {
        // Direct check for histogram type
        if (metric.type === 'histogram') {
            console.log(`Metric ${name} is a histogram by type declaration`);
            return true;
        }
        
        // Look for _bucket metrics
        const isHist = metrics.some(m => {
            // Check for bucket metrics with this base name
            if (m.name.startsWith(name + '_bucket') && m.labels && m.labels.le) {
                console.log(`Found bucket metric ${m.name} for ${name}`);
                return true;
            }
            
            // If this metric ends with _sum or _count, check the base name
            if (name.endsWith('_sum') || name.endsWith('_count')) {
                const baseName = name.replace(/_sum$|_count$/, '');
                const result = m.name.startsWith(baseName + '_bucket') && m.labels && m.labels.le;
                if (result) {
                    console.log(`Found bucket metric ${m.name} for base name ${baseName}`);
                }
                return result;
            }
            
            return false;
        });
        
        if (isHist) {
            console.log(`Metric ${name} is identified as a histogram`);
        }
        
        return isHist;
    }
    
    // Get histogram bucket data for a given metric
    function getHistogramBuckets(name) {
        console.log(`Getting histogram buckets for ${name}`);
        
        // Determine the base metric name (strip _sum or _count suffixes if present)
        const baseName = name.replace(/_sum$|_count$/, '');
        console.log(`Base metric name: ${baseName}`);
        
        // Find all bucket metrics
        const bucketMetrics = metrics.filter(m => 
            m.name.startsWith(baseName + '_bucket') && 
            m.labels && 
            m.labels.le
        );
        
        console.log(`Found ${bucketMetrics.length} bucket metrics`);
        if (bucketMetrics.length > 0) {
            console.log('First few bucket metrics:', bucketMetrics.slice(0, 3));
        }
        
        if (bucketMetrics.length === 0) {
            // Try a broader search for any buckets
            console.log(`No direct bucket metrics found for ${baseName}, checking all metrics with 'bucket' in the name`);
            const allBucketMetrics = metrics.filter(m => 
                m.name.includes('_bucket') && 
                m.labels && 
                m.labels.le
            );
            
            console.log(`Found ${allBucketMetrics.length} total bucket metrics in the system`);
            if (allBucketMetrics.length > 0) {
                console.log('All available bucket metrics bases:', 
                    [...new Set(allBucketMetrics.map(m => m.name.replace(/_bucket.*$/, '')))]);
            }
            
            return null;
        }
        
        // Sort buckets by their upper limit
        const sortedBuckets = bucketMetrics.sort((a, b) => {
            // Special handling for +Inf
            if (a.labels.le === '+Inf') return 1;
            if (b.labels.le === '+Inf') return -1;
            
            return parseFloat(a.labels.le) - parseFloat(b.labels.le);
        });
        
        // Log the bucket sizes
        console.log(`Sorted buckets:`, sortedBuckets.map(b => `${b.labels.le}=${b.value}`).join(', '));
        
        // Filter out the +Inf bucket for visualization
        const filteredBuckets = sortedBuckets.filter(b => b.labels.le !== '+Inf');
        
        // Calculate frequency in each bucket (the actual histogram data)
        const bucketData = [];
        let prevValue = 0;
        
        for (const bucket of filteredBuckets) {
            const value = bucket.value - prevValue;
            if (value >= 0) { // Ensure we don't have negative counts due to counter resets
                bucketData.push({
                    le: parseFloat(bucket.labels.le),
                    count: value
                });
            }
            prevValue = bucket.value;
        }
        
        console.log(`Generated ${bucketData.length} bucket data points`, bucketData);
        
        return bucketData;
    }
    
    // Render histogram background in a tile
    function renderHistogramBackground(tile, bucketData) {
        console.log(`Rendering histogram in tile for ${tile.dataset.metricName} with ${bucketData.length} buckets`);
        
        // Get or create histogram background container
        let histogramBg = tile.querySelector('.histogram-bg');
        if (!histogramBg) {
            console.log(`Creating new histogram background container`);
            histogramBg = document.createElement('div');
            histogramBg.className = 'histogram-bg';
            histogramBg.style.zIndex = "0"; // Ensure z-index is set correctly
            
            // Enable pointer events for the histogram to capture hover
            histogramBg.style.pointerEvents = "auto";
            
            // Add direct event handling for tooltips
            histogramBg.addEventListener('mousemove', (e) => {
                // Only process if the tooltip is visible
                const tooltip = document.getElementById('metric-tooltip');
                if (tooltip.style.display === 'block') {
                    // Check if this is the right tooltip
                    const tileName = tooltip.dataset.currentTile;
                    if (tileName === tile.dataset.metricName) {
                        // Find hovered histogram bar
                        const bars = Array.from(histogramBg.querySelectorAll('.histogram-bar'));
                        const tileRect = tile.getBoundingClientRect();
                        const relativeX = e.clientX - tileRect.left;
                        
                        // Find which bar is under the cursor by position
                        let hoveredBar = null;
                        for (const bar of bars) {
                            const barRect = bar.getBoundingClientRect();
                            const barLeft = barRect.left - tileRect.left;
                            const barRight = barLeft + barRect.width;
                            
                            if (relativeX >= barLeft && relativeX <= barRight) {
                                hoveredBar = bar;
                                break;
                            }
                        }
                        
                        // If we found a bar, update the tooltip
                        if (hoveredBar) {
                            // Check if we have bucket information
                            const bucketLe = hoveredBar.dataset.bucketLe;
                            const bucketCount = hoveredBar.dataset.bucketCount;
                            
                            if (bucketLe && bucketCount) {
                                // Update tooltip to show bucket info
                                const valueEl = tooltip.querySelector('.tooltip-value');
                                const helpEl = tooltip.querySelector('.tooltip-help');
                                
                                // Show bucket count as the value
                                if (valueEl && bucketCount) {
                                    valueEl.textContent = formatValue(parseFloat(bucketCount), tile.dataset.metricName);
                                }
                                
                                // Show upper limit in help text
                                if (helpEl && bucketLe) {
                                    const bucketText = `Upper limit: ≤ ${bucketLe}`;
                                    
                                    // Use the stored original text from the current tooltip session
                                    // but don't create it if it doesn't exist, as it should have been
                                    // set in the showTooltip function
                                    if (helpEl.dataset.originalText) {
                                        helpEl.textContent = `${helpEl.dataset.originalText}\n${bucketText}`;
                                    } else {
                                        helpEl.textContent = bucketText;
                                    }
                                    
                                    helpEl.style.display = 'block';
                                }
                            }
                        }
                        
                        // Also update tooltip position
                        moveTooltip(e);
                    }
                }
            });
            
            // Ensure tooltip shows when hovering over the histogram
            histogramBg.addEventListener('mouseenter', (e) => {
                if (document.getElementById('metric-tooltip').style.display !== 'block') {
                    // Forward to the tile's mouseenter handler
                    const event = new MouseEvent('mouseenter', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: e.clientX,
                        clientY: e.clientY
                    });
                    tile.dispatchEvent(event);
                }
            });
            
            tile.appendChild(histogramBg);
        } else {
            // Clear existing histogram bars
            console.log(`Clearing existing histogram background`);
            histogramBg.innerHTML = '';
        }
        
        // Find the maximum count to normalize heights
        const maxCount = Math.max(...bucketData.map(b => b.count));
        console.log(`Maximum bucket count: ${maxCount}`);
        
        if (maxCount <= 0) {
            console.log(`No data to visualize, max count is ${maxCount}`);
            return; // No data to visualize
        }
        
        // Create bars based on bucket data
        bucketData.forEach((bucket, index) => {
            if (bucket.count <= 0) {
                console.log(`Skipping bucket ${index} with count ${bucket.count}`);
                return; // Skip empty buckets
            }
            
            // Calculate relative height - limit to bottom 50% of the tile for aesthetics
            const heightPercent = Math.max(5, (bucket.count / maxCount) * 50);
            
            // Create bar element
            const bar = document.createElement('div');
            bar.className = 'histogram-bar';
            
            // Position and size
            bar.style.height = `${heightPercent}%`;
            bar.style.left = `${(index / bucketData.length) * 100}%`;
            
            // Width based on number of buckets
            const barWidth = Math.max(2, Math.min(8, 100 / bucketData.length - 1));
            bar.style.width = `${barWidth}%`;
            
            // Explicitly set background color and styles
            bar.style.backgroundColor = "var(--blue-color)";
            bar.style.borderRadius = "1px 1px 0 0";
            bar.style.border = "1px solid rgba(127, 127, 127, 0.3)";
            bar.style.position = "absolute";
            bar.style.bottom = "0";
            
            // Add tooltip data to the bar
            bar.dataset.bucketLe = bucket.le;
            bar.dataset.bucketCount = bucket.count;
            
            // Add to container
            histogramBg.appendChild(bar);
            console.log(`Added bar ${index}: height=${heightPercent}%, left=${(index / bucketData.length) * 100}%, width=${barWidth}%`);
        });
        
        // Store bucket data in tile for tooltip interaction
        tile.dataset.bucketData = JSON.stringify(bucketData);
        
        console.log(`Histogram rendering complete for ${tile.dataset.metricName}`);
    }
    
    // Render metrics table
    function renderMetrics() {
        // Get table container and save dimensions before updates
        const tableContainer = document.getElementById('table-view');
        const scrollTop = tableContainer.scrollTop;
        const containerWidth = tableContainer.clientWidth;
        
        // Apply filter and sorting
        const filteredMetrics = sortMetrics(filterMetrics(metrics));
        
        // Update sort indicators
        updateSortIndicators();
        
        // Clear existing rows if no metrics
        if (filteredMetrics.length === 0) {
            metricsTable.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: #6b7280;">
                        ${metrics.length === 0 ? 'No metrics available' : 'No metrics match your filter'}
                    </td>
                </tr>
            `;
            return;
        }
        
        // Create a temporary container for efficiency
        const tempContainer = document.createDocumentFragment();
        const existingRows = {};
        
        // Save references to existing rows for reuse
        Array.from(metricsTable.querySelectorAll('tr[data-id]')).forEach(row => {
            existingRows[row.dataset.id] = row;
        });
        
        // Add/update rows for each metric
        filteredMetrics.forEach(metric => {
            // Create a unique ID based on name and labels
            const labelsStr = metric.labels ? JSON.stringify(metric.labels) : '';
            const metricId = `${metric.name}|${labelsStr}`;
            
            let row;
            if (existingRows[metricId]) {
                // Update existing row - only update the value cell to minimize DOM changes
                row = existingRows[metricId];
                delete existingRows[metricId]; // Remove from the tracking object
                
                // Update value cell with highlight animation if changed
                const valueCell = row.querySelector('.value-cell');
                const newValue = formatValue(metric.value, metric.name);
                
                if (valueCell.textContent !== newValue) {
                    valueCell.textContent = newValue; // Update text directly
                    
                    // Apply highlight
                    valueCell.classList.remove('highlight');
                    void valueCell.offsetWidth; // Force reflow
                    valueCell.classList.add('highlight');
                }
            } else {
                // Create new row
                row = document.createElement('tr');
                row.dataset.id = metricId;
                row.className = 'metric-row';
                
                row.innerHTML = `
                    <td title="${metric.name}">${metric.name}</td>
                    <td>${metric.type}</td>
                    <td>${formatLabels(metric.labels)}</td>
                    <td class="value-cell">${formatValue(metric.value, metric.name)}</td>
                `;
            }
            
            tempContainer.appendChild(row);
        });
        
        // Force table width to remain the same during update
        if (tableContainer.style.width === '') {
            tableContainer.style.width = containerWidth + 'px';
        }
        
        // Remove any rows that weren't updated
        Object.values(existingRows).forEach(row => {
            row.remove();
        });
        
        // Replace table content
        metricsTable.innerHTML = '';
        metricsTable.appendChild(tempContainer);
        
        // Restore the table container's scroll position
        tableContainer.scrollTop = scrollTop;
    }
    
    // Format metric value for display
    function formatValue(value, metricName = '') {
        if (value === 0) return '0';
        
        // Auto-convert byte metrics to human-readable units (KB, MB, GB, TB)
        if (metricName && metricName.toLowerCase().includes('bytes')) {
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let unitIndex = 0;
            let scaledValue = value;
            
            // Scale the value down
            while (scaledValue >= 1024 && unitIndex < units.length - 1) {
                scaledValue /= 1024;
                unitIndex++;
            }
            
            // Format the value with appropriate precision
            // Use non-breaking space (\u00A0) between number and unit to prevent line breaks
            if (scaledValue < 10) {
                return `${scaledValue.toFixed(2)}\u00A0${units[unitIndex]}`;
            } else if (scaledValue < 100) {
                return `${scaledValue.toFixed(1)}\u00A0${units[unitIndex]}`;
            } else {
                return `${Math.round(scaledValue)}\u00A0${units[unitIndex]}`;
            }
        }
        
        // Format small or large numbers using scientific notation
        if (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6) {
            return value.toExponential(2);
        }
        
        // Format with up to 2 decimal places, but trim trailing zeros
        return Number(value.toFixed(2)).toString();
    }
    
    // Format labels for display
    function formatLabels(labels) {
        if (!labels || Object.keys(labels).length === 0) {
            return '<span style="color: var(--text-light);">-</span>';
        }
        
        return `<div class="label-container">${
            Object.entries(labels)
                .map(([key, value]) => {
                    return `<span class="label-badge">
                        <span class="label-key">${key}</span>
                        <span class="label-separator">=</span>
                        <span class="label-value" title="${value}">${value}</span>
                    </span>`;
                })
                .join('')
        }</div>`;
    }
    
    // Toggle between table and grid view
    function toggleViewMode() {
        // Save window scroll position for grid view
        const windowScrollPosition = window.scrollY;
        
        // Save table scroll position
        const tableContainer = document.getElementById('table-view');
        const tableScrollPosition = tableContainer ? tableContainer.scrollTop : 0;
        
        isGridView = !isGridView;
        
        if (isGridView) {
            tableView.style.display = 'none';
            gridView.style.display = 'block';
            toggleView.textContent = 'Table';
            toggleView.className = 'button button-gray';
            
            // Ensure dashboard is set up
            if (dashboardLayout.length === 0 || metricTiles.size === 0) {
                setupDashboard();
            }
            updateDashboard();
            
            // Restore window scroll for grid view
            setTimeout(() => {
                window.scrollTo({
                    top: windowScrollPosition,
                    behavior: 'auto'
                });
            }, 0);
        } else {
            gridView.style.display = 'none';
            tableView.style.display = 'block';
            toggleView.textContent = 'Grid';
            toggleView.className = 'button button-blue';
            renderMetrics();
            
            // Restore table scroll position
            setTimeout(() => {
                if (tableContainer) {
                    tableContainer.scrollTop = tableScrollPosition;
                }
            }, 0);
        }
    }
    
    // Event Listeners
    
    // Filter input
    filterInput.addEventListener('input', (e) => {
        // Save appropriate scroll positions
        const windowScrollPosition = window.scrollY;
        const tableContainer = document.getElementById('table-view');
        const tableScrollPosition = tableContainer ? tableContainer.scrollTop : 0;
        
        filterText = e.target.value.trim();
        
        if (isGridView) {
            updateDashboard();
            // Restore window scroll for grid view
            window.scrollTo({
                top: windowScrollPosition,
                behavior: 'auto'
            });
        } else {
            // Table view - renderMetrics handles its own scroll position
            renderMetrics();
        }
    });
    
    // Refresh interval slider
    refreshInterval.addEventListener('input', (e) => {
        interval = parseInt(e.target.value, 10);
        refreshValue.textContent = `${(interval / 1000).toFixed(1)}s`;
    });
    
    // Time window select
    timeWindow.addEventListener('change', (e) => {
        timeWindowMs = parseInt(e.target.value, 10);
        // Update all visualizations if in grid view
        if (isGridView) {
            updateDashboard();
        }
    });
    
    // Toggle pause/resume
    togglePause.addEventListener('click', () => {
        isPaused = !isPaused;
        togglePause.textContent = isPaused ? 'Resume' : 'Pause';
        togglePause.className = isPaused ? 'button button-green' : 'button button-blue';
    });
    
    // Toggle view mode
    toggleView.addEventListener('click', toggleViewMode);
    
    // Handle window resize
    window.addEventListener('resize', () => {
        initUIState();
    });
    
    // Initialize
    initUIState();
    fetchDashboard().then(() => {
        // Initialize WebSocket connection
        connectWebSocket();
        
        // Initialize table header sort functionality
        initTableSorting();
    });
    
    // Dashboard customization modal
    customizeDashboard.addEventListener('click', () => {
        // Setup the layout editor with current dashboard layout
        setupLayoutEditor();
        
        // Update the available metrics list
        updateAvailableMetricsList();
        
        // Show the modal
        dashboardModal.style.display = 'block';
    });
    
    // Close modal when clicking X
    closeModal.addEventListener('click', () => {
        dashboardModal.style.display = 'none';
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === dashboardModal) {
            dashboardModal.style.display = 'none';
        }
    });
    
    // Add row button
    addRowButton.addEventListener('click', addEditorRow);
    
    // Save layout button
    saveLayoutButton.addEventListener('click', saveCustomLayout);
    
    // Reset layout button
    resetLayoutButton.addEventListener('click', resetToDefaultLayout);
    
    // Filter metrics in the customization panel
    metricSearch.addEventListener('input', () => {
        updateAvailableMetricsList();
    });
    
    // Set up table sorting
    function initTableSorting() {
        tableHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const column = header.getAttribute('data-sort');
                
                // If clicking the same column, toggle direction
                if (column === sortColumn) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    // New column, set as active with ascending direction
                    sortColumn = column;
                    sortDirection = 'asc';
                }
                
                // Update display
                renderMetrics();
            });
        });
    }
    
    // Toggle dark/light mode
    toggleTheme.addEventListener('click', () => {
        isDarkMode = !isDarkMode;
        
        // Save preference to localStorage
        localStorage.setItem('darkMode', isDarkMode);
        
        // Update URL hash
        updateThemeInURLHash();
        
        // Apply theme
        if (isDarkMode) {
            document.body.classList.add('dark-mode');
            lightIcon.style.display = 'none';
            darkIcon.style.display = 'block';
        } else {
            document.body.classList.remove('dark-mode');
            lightIcon.style.display = 'block';
            darkIcon.style.display = 'none';
        }
    });

    // Listen for hash changes
    window.addEventListener('hashchange', () => {
        checkThemeFromURLHash();
        initUIState();
    });
}); 