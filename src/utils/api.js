const API_URL = 'http://localhost:5000/api';

export const api = {
  // Get all documents
  getDocuments: async () => {
    const response = await fetch(`${API_URL}/documents`);
    return response.json();
  },

  // Get single document
  getDocument: async (id) => {
    const response = await fetch(`${API_URL}/documents/${id}`);
    return response.json();
  },

  // Create document
  createDocument: async (data) => {
    const response = await fetch(`${API_URL}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  // Update document
  updateDocument: async (id, data) => {
    const response = await fetch(`${API_URL}/documents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  // Delete document
  deleteDocument: async (id) => {
    const response = await fetch(`${API_URL}/documents/${id}`, {
      method: 'DELETE',
    });
    return response.json();
  },
};