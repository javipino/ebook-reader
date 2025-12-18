import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import ReaderPage from './pages/ReaderPage'
import LoginPage from './pages/LoginPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="library" element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
            <Route path="reader/:bookId" element={<ProtectedRoute><ReaderPage /></ProtectedRoute>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
