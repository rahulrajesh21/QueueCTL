let currentFilter = null;


async function loadData() {
  await Promise.all([
    loadStats(),
    loadJobs(currentFilter),
    loadDLQ()
  ]);
  updateLastUpdate();
}


async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    
    const statsGrid = document.getElementById('stats');
    statsGrid.innerHTML = `
      <div class="stat-card pending">
        <div class="stat-value">${stats.pending || 0}</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card processing">
        <div class="stat-value">${stats.processing || 0}</div>
        <div class="stat-label">Processing</div>
      </div>
      <div class="stat-card completed">
        <div class="stat-value">${stats.completed || 0}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-card failed">
        <div class="stat-value">${stats.failed || 0}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card dead">
        <div class="stat-value">${stats.dead || 0}</div>
        <div class="stat-label">Dead (DLQ)</div>
      </div>
    `;
    
    // Update filter buttons with counts
    updateFilterButtons(stats);
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

function updateFilterButtons(stats) {
  const total = (stats.pending || 0) + (stats.processing || 0) + (stats.completed || 0) + (stats.failed || 0);
  const filterButtons = document.getElementById('filter-buttons');
  filterButtons.innerHTML = `
    <button class="filter-btn ${currentFilter === null ? 'active' : ''}" onclick="filterJobs(null)">
      All <span class="count">${total}</span>
    </button>
    <button class="filter-btn ${currentFilter === 'pending' ? 'active' : ''}" onclick="filterJobs('pending')">
      Pending <span class="count">${stats.pending || 0}</span>
    </button>
    <button class="filter-btn ${currentFilter === 'processing' ? 'active' : ''}" onclick="filterJobs('processing')">
      Processing <span class="count">${stats.processing || 0}</span>
    </button>
    <button class="filter-btn ${currentFilter === 'completed' ? 'active' : ''}" onclick="filterJobs('completed')">
      Completed <span class="count">${stats.completed || 0}</span>
    </button>
    <button class="filter-btn ${currentFilter === 'failed' ? 'active' : ''}" onclick="filterJobs('failed')">
      Failed <span class="count">${stats.failed || 0}</span>
    </button>
  `;
}


async function loadJobs(state = null) {
  try {
    const url = state ? `/api/jobs?state=${state}` : '/api/jobs';
    const res = await fetch(url);
    const jobs = await res.json();
    
    const jobsDiv = document.getElementById('jobs');
    
    if (jobs.length === 0) {
      jobsDiv.innerHTML = '<p class="empty">No jobs found</p>';
      return;
    }
    
    const priorityLabels = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
    const priorityColors = ['#666', '#888', '#ffa500', '#ff6b6b'];
    
    jobsDiv.innerHTML = jobs.slice(0, 20).map(job => `
      <div class="job-card">
        <div class="job-header">
          <span class="job-id">${job.id}</span>
          <span class="job-priority" style="background: ${priorityColors[job.priority || 0]}; padding: 4px 10px; border-radius: 4px; font-size: 0.7em; font-weight: 600; margin: 0 8px;">${priorityLabels[job.priority || 0]}</span>
          <span class="job-state state-${job.state}">${job.state.toUpperCase()}</span>
        </div>
        <div class="job-command">${escapeHtml(job.command)}</div>
        <div class="job-meta">
          <span>Attempts: ${job.attempts}/${job.max_retries}</span>
          <span>Created: ${formatDate(job.created_at)}</span>
        </div>
        ${job.error ? `<div class="job-error">${escapeHtml(job.error)}</div>` : ''}
        ${job.output ? `
          <div class="job-output-section">
            <div class="job-output-label">OUTPUT</div>
            <div class="job-output">${escapeHtml(job.output)}</div>
          </div>
        ` : ''}
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading jobs:', error);
  }
}


async function loadDLQ() {
  try {
    const res = await fetch('/api/dlq');
    const jobs = await res.json();
    
    const dlqDiv = document.getElementById('dlq');
    
    if (jobs.length === 0) {
      dlqDiv.innerHTML = '<p class="empty">DLQ is empty</p>';
      return;
    }
    
    dlqDiv.innerHTML = jobs.map(job => `
      <div class="job-card">
        <div class="job-header">
          <span class="job-id">${job.id}</span>
          <span class="job-state state-dead">DEAD</span>
        </div>
        <div class="job-command">${escapeHtml(job.command)}</div>
        <div class="job-meta">
          <span>Attempts: ${job.attempts}/${job.max_retries}</span>
          <span>Failed: ${formatDate(job.updated_at)}</span>
        </div>
        <div class="job-error">Error: ${escapeHtml(job.error || 'Unknown')}</div>
        <button class="retry-btn" onclick="retryJob('${job.id}')">Retry</button>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading DLQ:', error);
  }
}


async function retryJob(jobId) {
  try {
    await fetch(`/api/dlq/${jobId}/retry`, { method: 'POST' });
    alert('Job moved back to queue!');
    loadData();
  } catch (error) {
    alert('Error retrying job: ' + error.message);
  }
}


function filterJobs(state) {
  currentFilter = state;
  loadData();
}


function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateLastUpdate() {
  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}


setInterval(loadData, 5000);


loadData();
