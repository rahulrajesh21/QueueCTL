async function loadMetrics() {
  try {
    const [metricsRes, statsRes] = await Promise.all([
      fetch('/api/metrics'),
      fetch('/api/stats')
    ]);
    
    const metrics = await metricsRes.json();
    const stats = await statsRes.json();
    
    // Performance Metrics
    const totalProcessed = stats.completed + stats.failed + stats.dead;
    const successRate = totalProcessed > 0 ? ((stats.completed / totalProcessed) * 100).toFixed(1) : 0;
    const failureRate = totalProcessed > 0 ? (((stats.failed + stats.dead) / totalProcessed) * 100).toFixed(1) : 0;
    
    document.getElementById('performance-metrics').innerHTML = `
      <div class="metric-card">
        <div class="metric-label">Success Rate</div>
        <div class="metric-value success">${successRate}%</div>
        <div class="metric-detail">${stats.completed} completed</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Failure Rate</div>
        <div class="metric-value failure">${failureRate}%</div>
        <div class="metric-detail">${stats.failed + stats.dead} failed</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Processed</div>
        <div class="metric-value">${totalProcessed}</div>
        <div class="metric-detail">all time</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Active Jobs</div>
        <div class="metric-value">${stats.pending + stats.processing}</div>
        <div class="metric-detail">${stats.pending} pending, ${stats.processing} processing</div>
      </div>
    `;
    
    // Execution Statistics
    if (metrics.avgExecutionTime) {
      document.getElementById('execution-metrics').innerHTML = `
        <div class="metric-card">
          <div class="metric-label">Average Execution</div>
          <div class="metric-value">${metrics.avgExecutionTime.toFixed(2)}<span style="font-size: 0.5em;">s</span></div>
          <div class="metric-detail">mean time</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Min Execution</div>
          <div class="metric-value">${metrics.minExecutionTime.toFixed(2)}<span style="font-size: 0.5em;">s</span></div>
          <div class="metric-detail">fastest job</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Max Execution</div>
          <div class="metric-value">${metrics.maxExecutionTime.toFixed(2)}<span style="font-size: 0.5em;">s</span></div>
          <div class="metric-detail">slowest job</div>
        </div>
      `;
    } else {
      document.getElementById('execution-metrics').innerHTML = `
        <p class="empty">No execution data available yet</p>
      `;
    }
    
    // Retry Statistics
    document.getElementById('retry-metrics').innerHTML = `
      <div class="metric-card">
        <div class="metric-label">Jobs with Retries</div>
        <div class="metric-value">${metrics.jobsWithRetries || 0}</div>
        <div class="metric-detail">required retry</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Retry Attempts</div>
        <div class="metric-value">${metrics.totalRetries || 0}</div>
        <div class="metric-detail">all attempts</div>
      </div>
    `;
    
    updateLastUpdate();
  } catch (error) {
    console.error('Error loading metrics:', error);
  }
}

function updateLastUpdate() {
  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}

// Auto-refresh every 5 seconds
setInterval(loadMetrics, 5000);

// Initial load
loadMetrics();
