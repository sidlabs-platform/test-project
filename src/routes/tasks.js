const express = require('express');
const router = express.Router();

// In-memory store
let nextId = 4;
const tasks = [
  { id: 1, title: 'Design landing page', description: 'Create wireframes and mockups', status: 'done',        priority: 'high',   createdAt: '2026-05-10T09:00:00Z' },
  { id: 2, title: 'Set up CI/CD pipeline', description: 'Configure Azure DevOps pipelines', status: 'in-progress', priority: 'high',   createdAt: '2026-05-12T10:30:00Z' },
  { id: 3, title: 'Write unit tests',      description: 'Add Jest tests for API routes',    status: 'todo',        priority: 'medium', createdAt: '2026-05-14T14:00:00Z' },
];

// GET all tasks (optional ?status= filter)
router.get('/', (req, res) => {
  const { status } = req.query;
  const result = status ? tasks.filter(t => t.status === status) : tasks;
  res.json(result);
});

// GET single task
router.get('/:id', (req, res) => {
  const task = tasks.find(t => t.id === Number.parseInt(req.params.id, 10));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// POST create task
router.post('/', (req, res) => {
  const { title, description, priority } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const task = {
    id: nextId++,
    title: title.trim(),
    description: (description || '').trim(),
    status: 'todo',
    priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  res.status(201).json(task);
});

// PATCH update task (title, description, status, priority)
router.patch('/:id', (req, res) => {
  const task = tasks.find(t => t.id === Number.parseInt(req.params.id, 10));
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const allowed = ['title', 'description', 'status', 'priority'];
  const validStatuses = ['todo', 'in-progress', 'done'];
  const validPriorities = ['low', 'medium', 'high'];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === 'status' && !validStatuses.includes(req.body[key])) {
        return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
      }
      if (key === 'priority' && !validPriorities.includes(req.body[key])) {
        return res.status(400).json({ error: `Invalid priority. Use: ${validPriorities.join(', ')}` });
      }
      task[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
    }
  }
  res.json(task);
});

// DELETE task
router.delete('/:id', (req, res) => {
  const idx = tasks.findIndex(t => t.id === Number.parseInt(req.params.id, 10));
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  tasks.splice(idx, 1);
  res.status(204).end();
});

module.exports = router;
