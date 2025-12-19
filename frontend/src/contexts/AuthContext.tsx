import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  username: string | null
  userId: string | null
  login: (token: string, username: string, userId: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [username, setUsername] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    // Check if user is already logged in
    const token = localStorage.getItem('token')
    const storedUsername = localStorage.getItem('username')
    const storedUserId = localStorage.getItem('userId')
    
    if (token && storedUsername && storedUserId) {
      setIsAuthenticated(true)
      setUsername(storedUsername)
      setUserId(storedUserId)
    }
    setIsLoading(false)
  }, [])

  const login = (token: string, username: string, userId: string) => {
    localStorage.setItem('token', token)
    localStorage.setItem('username', username)
    localStorage.setItem('userId', userId)
    setIsAuthenticated(true)
    setUsername(username)
    setUserId(userId)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    localStorage.removeItem('userId')
    setIsAuthenticated(false)
    setUsername(null)
    setUserId(null)
    navigate('/login')
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, username, userId, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
