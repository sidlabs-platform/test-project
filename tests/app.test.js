const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  it('returns healthy status', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('GET /api/tasks', () => {
  it('returns all seed tasks', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it('filters tasks by status', async () => {
    const res = await request(app).get('/api/tasks?status=done');
    expect(res.statusCode).toBe(200);
    res.body.forEach(t => expect(t.status).toBe('done'));
  });
});

describe('GET /api/tasks/:id', () => {
  it('returns a single task', async () => {
    const res = await request(app).get('/api/tasks/1');
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it('returns 404 for missing task', async () => {
    const res = await request(app).get('/api/tasks/999');
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/tasks', () => {
  it('creates a new task', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'Test task', description: 'Created by test', priority: 'high' });
    expect(res.statusCode).toBe(201);
    expect(res.body.title).toBe('Test task');
    expect(res.body.status).toBe('todo');
    expect(res.body.priority).toBe('high');
  });

  it('rejects task without title', async () => {
    const res = await request(app).post('/api/tasks').send({ description: 'No title' });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/tasks/:id', () => {
  it('updates task status', async () => {
    const res = await request(app)
      .patch('/api/tasks/1')
      .send({ status: 'in-progress' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('in-progress');
  });

  it('rejects invalid status', async () => {
    const res = await request(app)
      .patch('/api/tasks/1')
      .send({ status: 'invalid' });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('deletes a task', async () => {
    // create one first
    const created = await request(app)
      .post('/api/tasks')
      .send({ title: 'To delete' });
    const res = await request(app).delete(`/api/tasks/${created.body.id}`);
    expect(res.statusCode).toBe(204);
  });

  it('returns 404 for missing task', async () => {
    const res = await request(app).delete('/api/tasks/999');
    expect(res.statusCode).toBe(404);
  });
});
