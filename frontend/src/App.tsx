import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import ReaderPage from './pages/ReaderPage'
import LoginPage from './pages/LoginPage'
import KindleSettingsPage from './pages/KindleSettingsPage'
import AdminSettingsPage from './pages/AdminSettingsPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="library" element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
            <Route path="reader/:bookId" element={<ProtectedRoute><ReaderPage /></ProtectedRoute>} />
            <Route path="kindle-settings" element={<ProtectedRoute><KindleSettingsPage /></ProtectedRoute>} />
            <Route path="admin/settings" element={<ProtectedRoute><AdminSettingsPage /></ProtectedRoute>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
