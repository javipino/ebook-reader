import { useState, useEffect } from 'react';
import kindleService, { KindleAccountStatus } from '../services/kindleService';
import { toast } from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

export default function KindleSettingsPage() {
  const { email } = useAuth();
  const [status, setStatus] = useState<KindleAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  
  const [formData, setFormData] = useState({
    email: email || '',
    sessionCookies: '',
    marketplace: 'es'
  });

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const data = await kindleService.getStatus();
      setStatus(data);
    } catch (error) {
      console.error('Error loading Kindle status:', error);
      toast.error('Failed to load Kindle account status');
    } finally {
      setLoading(false);
    }
  };

  const handleValidateCookies = async () => {
    if (!formData.sessionCookies.trim()) {
      toast.error('Please enter your session cookies first');
      return;
    }

    try {
      setValidating(true);
      const isValid = await kindleService.validateCookies(formData.sessionCookies, formData.marketplace);
      
      if (isValid) {
        toast.success('Cookies are valid! You can now connect.');
      } else {
        toast.error('Cookies are invalid or expired. Please get fresh cookies from your browser.');
      }
    } catch (error) {
      console.error('Error validating cookies:', error);
      toast.error('Failed to validate cookies');
    } finally {
      setValidating(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.email.trim() || !formData.sessionCookies.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      setConnecting(true);
      await kindleService.connectAccount(formData);
      toast.success('Kindle account connected successfully!');
      setShowConnectForm(false);
      setFormData({ email: '', sessionCookies: '', marketplace: 'com' });
      await loadStatus();
    } catch (error: any) {
      console.error('Error connecting Kindle account:', error);
      toast.error(error.response?.data?.message || 'Failed to connect Kindle account. Your cookies may be invalid or expired.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Kindle account?')) {
      return;
    }

    try {
      await kindleService.disconnectAccount();
      toast.success('Kindle account disconnected');
      await loadStatus();
    } catch (error) {
      console.error('Error disconnecting Kindle account:', error);
      toast.error('Failed to disconnect Kindle account');
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      const result = await kindleService.syncLibrary();
      
      if (result.success) {
        const messages = [];
        if (result.booksAdded > 0) messages.push(`${result.booksAdded} documents added`);
        if (result.booksUpdated > 0) messages.push(`${result.booksUpdated} documents updated`);
        if (result.progressSynced > 0) messages.push(`${result.progressSynced} reading positions synced`);
        
        const message = messages.length > 0 ? messages.join(', ') : 'Documents are up to date (0 found)';
        toast.success(message, { duration: 5000 });
        
        if (result.errors.length > 0) {
          result.errors.forEach(err => toast.error(err, { duration: 5000 }));
        }
      } else {
        toast.error(result.errorMessage || 'Sync failed');
      }
      
      await loadStatus();
    } catch (error: any) {
      console.error('Error syncing Kindle library:', error);
      toast.error(error.response?.data?.message || 'Failed to sync Kindle library');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Kindle Settings</h1>

        {/* Status Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Account Status</h2>
          
          {status?.isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="font-medium text-gray-900">{status.email}</p>
                </div>
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                  Connected
                </span>
              </div>

              <div>
                <p className="text-sm text-gray-600">Marketplace</p>
                <p className="font-medium text-gray-900">amazon.{status.marketplace}</p>
              </div>

              <div>
                <p className="text-sm text-gray-600">Total Documents Synced</p>
                <p className="font-medium text-gray-900">{status.totalBooks}</p>
              </div>

              {status.lastSyncedAt && (
                <div>
                  <p className="text-sm text-gray-600">Last Synced</p>
                  <p className="font-medium text-gray-900">{new Date(status.lastSyncedAt).toLocaleString()}</p>
                </div>
              )}

              {status.lastSyncError && (
                <div className="p-3 bg-red-50 rounded-md">
                  <p className="text-sm text-red-800">{status.lastSyncError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {syncing ? 'Syncing...' : 'Sync Library Now'}
                </button>
                
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">No Kindle account connected</p>
              
              {!showConnectForm ? (
                <button
                  onClick={() => setShowConnectForm(true)}
                  className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Connect Kindle Account
                </button>
              ) : (
                <form onSubmit={handleConnect} className="max-w-xl mx-auto space-y-4 text-left">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Amazon Email
                    </label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="your@email.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Amazon Marketplace
                    </label>
                    <select
                      value={formData.marketplace}
                      onChange={(e) => setFormData({ ...formData, marketplace: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="com">United States (.com)</option>
                      <option value="co.uk">United Kingdom (.co.uk)</option>
                      <option value="de">Germany (.de)</option>
                      <option value="fr">France (.fr)</option>
                      <option value="es">Spain (.es)</option>
                      <option value="it">Italy (.it)</option>
                      <option value="ca">Canada (.ca)</option>
                      <option value="com.au">Australia (.com.au)</option>
                      <option value="co.jp">Japan (.co.jp)</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700">
                        Session Cookies
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowInstructions(!showInstructions)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        {showInstructions ? 'Hide instructions' : 'How to get cookies?'}
                      </button>
                    </div>
                    <textarea
                      required
                      value={formData.sessionCookies}
                      onChange={(e) => setFormData({ ...formData, sessionCookies: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      placeholder="Paste your cookies here..."
                      rows={4}
                    />
                    <button
                      type="button"
                      onClick={handleValidateCookies}
                      disabled={validating || !formData.sessionCookies.trim()}
                      className="mt-2 text-sm px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
                    >
                      {validating ? 'Validating...' : 'Validate Cookies'}
                    </button>
                  </div>

                  {showInstructions && (
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm">
                      <h4 className="font-semibold text-blue-900 mb-2">How to get your Amazon cookies (EASIEST WAY):</h4>
                      <ol className="list-decimal list-inside space-y-2 text-blue-800">
                        <li>
                          Install browser extension <strong>"EditThisCookie"</strong> or <strong>"Cookie-Editor"</strong>
                        </li>
                        <li>
                          Go to{' '}
                          <a 
                            href={`https://www.amazon.${formData.marketplace}/hz/mycd/digital-console/contentlist/pdocs/dateDsc/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline font-medium"
                          >
                            Amazon Personal Documents
                          </a>{' '}and log in
                        </li>
                        <li>Click the extension icon</li>
                        <li>Click <strong>"Export"</strong> button</li>
                        <li>Paste the exported JSON directly into the field above</li>
                      </ol>
                      
                      <div className="mt-3 p-2 bg-green-100 border border-green-300 rounded">
                        <p className="text-green-800">
                          <strong>✓ Supported formats:</strong> JSON array (from extensions), JSON object, or semicolon-separated string
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                    <p className="text-sm text-gray-700">
                      <strong className="text-yellow-800">⚠️ Security Note:</strong> Your cookies are encrypted before being stored. 
                      They will expire when Amazon invalidates them (usually after a few weeks). 
                      You may need to refresh them periodically.
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={connecting}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {connecting ? 'Connecting...' : 'Connect'}
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        setShowConnectForm(false);
                        setShowInstructions(false);
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Info Card */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-2">How it works</h3>
          <ul className="text-sm text-blue-800 space-y-2">
            <li>• This syncs your <strong>Personal Documents</strong> (Send to Kindle), not purchased books</li>
            <li>• Personal documents are NOT DRM protected and can be downloaded</li>
            <li>• You need to manually copy cookies from your browser after logging in to Amazon</li>
            <li>• Cookies typically expire after a few weeks - you may need to refresh them</li>
            <li>• Reading progress syncs between this app and Kindle</li>
            <li>• Purchased books cannot be synced due to DRM protection</li>
          </ul>
        </div>

        {/* What are Personal Documents */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mt-4">
          <h3 className="font-semibold text-gray-900 mb-2">What are Personal Documents?</h3>
          <p className="text-sm text-gray-700 mb-3">
            Personal Documents are files you've sent to your Kindle via:
          </p>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• <strong>Send to Kindle</strong> email (your-name@kindle.com)</li>
            <li>• <strong>Amazon's Send to Kindle</strong> app or website</li>
            <li>• <strong>USB transfer</strong> to your Kindle device</li>
          </ul>
          <p className="text-sm text-gray-500 mt-3">
            These include EPUBs, PDFs, MOBIs, and other documents you've added yourself.
          </p>
        </div>
      </div>
    </div>
  );
}
