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
      <div class="stat-card">
        <div class="stat-value">${stats.pending || 0}</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.processing || 0}</div>
        <div class="stat-label">Processing</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.completed || 0}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.failed || 0}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.dead || 0}</div>
        <div class="stat-label">Dead (DLQ)</div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading stats:', error);
  }
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
    
    jobsDiv.innerHTML = jobs.slice(0, 20).map(job => `
      <div class="job-card">
        <div class="job-header">
          <span class="job-id">${job.id}</span>
          <span class="job-state state-${job.state}">${job.state.toUpperCase()}</span>
        </div>
        <div class="job-command">${escapeHtml(job.command)}</div>
        <div class="job-meta">
          <span>Attempts: ${job.attempts}/${job.max_retries}</span>
          <span>Created: ${formatDate(job.created_at)}</span>
        </div>
        ${job.error ? `<div class="job-error">Error: ${escapeHtml(job.error)}</div>` : ''}
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
      dlqDiv.innerHTML = '<p class="empty">DLQ is empty ✨</p>';
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
        <button class="retry-btn" onclick="retryJob('${job.id}')">🔄 Retry</button>
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
  

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  loadJobs(state);
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
