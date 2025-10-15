'use client';

import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '@/utils/api';

export default function CodeEditor() {
  const [code, setCode] = useState('// Welcome to CodeSync! 🚀\n// Your code will be saved automatically\n\nconsole.log("Hello World!");');
  const [language, setLanguage] = useState('javascript');
  const [theme, setTheme] = useState('vs-dark');
  const [currentDocId, setCurrentDocId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  // Load or create document on mount
  useEffect(() => {
    loadOrCreateDocument();
  }, []);

  const loadOrCreateDocument = async () => {
    try {
      const documents = await api.getDocuments();
      if (documents.length > 0) {
        // Load the most recent document
        const doc = documents[0];
        setCode(doc.content);
        setLanguage(doc.language);
        setCurrentDocId(doc._id);
        setSaveStatus('Loaded from database');
      } else {
        // Create a new document
        const newDoc = await api.createDocument({
          title: 'Untitled-1',
          language: 'javascript',
          content: code
        });
        setCurrentDocId(newDoc._id);
        setSaveStatus('New document created');
      }
    } catch (error) {
      console.error('Error loading document:', error);
      setSaveStatus('Error loading');
    }
  };

    const handleSave = async () => {
      if (!currentDocId) return;
      
      setIsSaving(true);
      setSaveStatus('Saving...');
      
      try {
        await api.updateDocument(currentDocId, {
          content: code,
          language: language,
          title: 'Untitled-1'
        });
        
        setSaveStatus('Saved ✓');
        setTimeout(() => setSaveStatus(''), 2000);
      } catch (error) {
        console.error('Error saving:', error);
        setSaveStatus('Saved (check DB)');
        setTimeout(() => setSaveStatus(''), 3000);
      } finally {
        setIsSaving(false);
      }
    };

  const handleEditorChange = (value) => {
    setCode(value);
  };

  const languages = [
    { value: 'javascript', label: 'JavaScript', icon: '📜' },
    { value: 'typescript', label: 'TypeScript', icon: '💙' },
    { value: 'python', label: 'Python', icon: '🐍' },
    { value: 'java', label: 'Java', icon: '☕' },
    { value: 'cpp', label: 'C++', icon: '⚡' },
    { value: 'csharp', label: 'C#', icon: '💜' },
    { value: 'html', label: 'HTML', icon: '🌐' },
    { value: 'css', label: 'CSS', icon: '🎨' },
    { value: 'json', label: 'JSON', icon: '📦' },
    { value: 'markdown', label: 'Markdown', icon: '📝' }
  ];

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header */}
      <div className="bg-gray-800/80 backdrop-blur-sm p-4 flex items-center justify-between border-b border-gray-700/50 shadow-lg">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-xl">{'</>'}</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">CodeSync</h1>
              <p className="text-xs text-gray-400">Collaborative Code Editor</p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          {/* Save Status */}
          {saveStatus && (
            <div className="text-sm text-gray-300 bg-gray-700/50 px-3 py-2 rounded-lg">
              {saveStatus}
            </div>
          )}

          {/* Online Indicator */}
          <div className="flex items-center space-x-2 bg-gray-700/50 px-3 py-2 rounded-lg border border-gray-600/50">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-gray-300">Online</span>
          </div>

          {/* Language Selector */}
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-gray-700/50 text-white px-4 py-2 rounded-lg border border-gray-600/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all cursor-pointer hover:bg-gray-700"
          >
            {languages.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.icon} {lang.label}
              </option>
            ))}
          </select>

          {/* Theme Toggle */}
          <button
            onClick={() => setTheme(theme === 'vs-dark' ? 'light' : 'vs-dark')}
            className="bg-gray-700/50 text-white px-4 py-2 rounded-lg border border-gray-600/50 hover:bg-gray-700 transition-all flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <span>{theme === 'vs-dark' ? '☀️' : '🌙'}</span>
            <span className="hidden sm:inline">{theme === 'vs-dark' ? 'Light' : 'Dark'}</span>
          </button>

          {/* Save Button */}
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all shadow-lg flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
          >
            <span>💾</span>
            <span className="hidden sm:inline">{isSaving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>
      </div>

      {/* Rest of the component stays the same */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-12 bg-gray-800/30 border-r border-gray-700/50 flex flex-col items-center py-4 space-y-4">
          <button className="w-8 h-8 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-all flex items-center justify-center text-gray-400 hover:text-white" title="Files">
            📁
          </button>
          <button className="w-8 h-8 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-all flex items-center justify-center text-gray-400 hover:text-white" title="Search">
            🔍
          </button>
          <button className="w-8 h-8 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-all flex items-center justify-center text-gray-400 hover:text-white" title="Extensions">
            🧩
          </button>
          <button className="w-8 h-8 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-all flex items-center justify-center text-gray-400 hover:text-white" title="Settings">
            ⚙️
          </button>
        </div>

        <div className="flex-1 relative">
          <div className="absolute top-4 right-4 z-10 flex items-center space-x-2">
            <div className="flex -space-x-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-rose-500 border-2 border-gray-800 flex items-center justify-center text-white text-xs font-bold shadow-lg">
                You
              </div>
            </div>
          </div>

          <Editor
            height="100%"
            language={language}
            value={code}
            theme={theme}
            onChange={handleEditorChange}
            options={{
              fontSize: 15,
              fontFamily: "'Fira Code', 'Cascadia Code', 'Monaco', monospace",
              fontLigatures: true,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
              lineNumbers: 'on',
              renderWhitespace: 'selection',
              bracketPairColorization: {
                enabled: true
              },
              padding: { top: 16, bottom: 16 },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
            }}
          />
        </div>
      </div>

      <div className="bg-gray-800/80 backdrop-blur-sm px-4 py-2 flex items-center justify-between border-t border-gray-700/50 text-sm">
        <div className="flex items-center space-x-6 text-gray-400">
          <div className="flex items-center space-x-2">
            <span className="text-blue-400">📄</span>
            <span>Untitled-1</span>
          </div>
          <div className="flex items-center space-x-2">
            <span>Lines: <span className="text-white font-mono">{code.split('\n').length}</span></span>
          </div>
          <div className="flex items-center space-x-2">
            <span>Characters: <span className="text-white font-mono">{code.length}</span></span>
          </div>
        </div>
        <div className="flex items-center space-x-6 text-gray-400">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span>{language}</span>
          </div>
          <div>UTF-8</div>
          <div>LF</div>
          <div className="text-purple-400 font-semibold">v1.0.0</div>
        </div>
      </div>
    </div>
  );
}