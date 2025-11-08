import express from 'express';
import queue from '../core/queue.js';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('web/public'));

app.get('/api/stats',(req,res)=>{
    try{
        const stats = queue.getStats();
        res.json(stats)
    }catch(error){
        res.status(500).json({error:error.message});
    }
})

app.get('/api/jobs',(req,res)=>{
    try{
        const state = req.query.state;
        const jobs = queue.listJobs(state);
        res.json(jobs)
    }catch(error){
        res.status(500).json({error:error.message});
    }
});

app.post('/api/jobs', (req, res) => {
    try {
        const job = queue.enqueue(req.body);
        res.json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/dlq',(req,res)=>{
    try{
        const jobs = queue.listDLQ();
        res.json(jobs);
    }catch(error){
        res.status(500).json({error:error.message});
    }
});

app.post('/api/dlq/:id/retry', (req, res) => {
    try {
        const job = queue.retryFromDLQ(req.params.id);
        res.json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.listen(PORT,()=>{
    console.log(`🚀 QueueCTL Dashboard running at http://localhost:${PORT}`);
});
