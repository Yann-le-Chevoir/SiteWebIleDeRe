const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5173;
const HOST = process.env.HOST || '0.0.0.0';

const DATA_DIR = path.join(__dirname, 'data');
const CONFIGS_FILE = path.join(DATA_DIR, 'configs.json');

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function ensureData(){
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(CONFIGS_FILE)) fs.writeFileSync(CONFIGS_FILE, JSON.stringify({}), 'utf8');
}
function readAll(){
  ensureData();
  try { return JSON.parse(fs.readFileSync(CONFIGS_FILE, 'utf8') || '{}'); } catch { return {}; }
}
function writeAll(obj){
  ensureData();
  fs.writeFileSync(CONFIGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// API
app.get('/api/configs', (req, res)=>{
  res.json(readAll());
});
app.get('/api/configs/:name', (req, res)=>{
  const all = readAll();
  const obj = all[req.params.name];
  if (!obj) return res.status(404).json({ error: 'Not found' });
  res.json(obj);
});
app.post('/api/configs/:name', (req, res)=>{
  const all = readAll();
  all[req.params.name] = req.body || {};
  writeAll(all);
  res.json({ ok: true });
});
app.delete('/api/configs/:name', (req, res)=>{
  const all = readAll();
  delete all[req.params.name];
  writeAll(all);
  res.json({ ok: true });
});

// Static files
app.use(express.static(__dirname));

app.listen(PORT, HOST, ()=>{
  console.log(`Server running at http://${HOST}:${PORT}`);
});
