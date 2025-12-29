import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';

type TtsProvider = 'elevenlabs' | 'azure';

interface UserTtsSettingsDto {
  preferredTtsProvider: TtsProvider;
  preferredAzureVoiceName: string | null;
  enableSsmlEnhancement: boolean;
}

export default function AdminSettingsPage() {
  const [provider, setProvider] = useState<TtsProvider>('elevenlabs');
  const [azureVoiceName, setAzureVoiceName] = useState<string>('');
  const [enableSsml, setEnableSsml] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<UserTtsSettingsDto>('/api/users/me/settings');
        setProvider(res.data.preferredTtsProvider === 'azure' ? 'azure' : 'elevenlabs');
        setAzureVoiceName(res.data.preferredAzureVoiceName ?? '');
        setEnableSsml(res.data.enableSsmlEnhancement ?? false);
      } catch (e: any) {
        toast.error(e.response?.data?.message || 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    try {
      await api.put('/api/users/me/settings', {
        preferredTtsProvider: provider,
        preferredAzureVoiceName: azureVoiceName.trim() || null,
        enableSsmlEnhancement: enableSsml
      });
      toast.success('Settings saved');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to save settings');
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-semibold text-gray-900">Admin Settings</h1>
        <p className="mt-2 text-sm text-gray-600">Choose which TTS provider the reader uses.</p>

        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700">TTS Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as TtsProvider)}
            disabled={loading}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            <option value="elevenlabs">ElevenLabs</option>
            <option value="azure">Azure Speech</option>
          </select>
        </div>

        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700">Azure Voice Name (optional)</label>
          <input
            value={azureVoiceName}
            onChange={(e) => setAzureVoiceName(e.target.value)}
            placeholder="e.g. en-US-JennyNeural or es-ES-ElviraNeural"
            disabled={loading}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          <p className="mt-2 text-xs text-gray-500">If blank, backend uses AzureSpeech:DefaultVoiceName.</p>
        </div>

        <div className="mt-6">
          <div className="flex items-center">
            <input
              id="enable-ssml"
              type="checkbox"
              checked={enableSsml}
              onChange={(e) => setEnableSsml(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
            />
            <label htmlFor="enable-ssml" className="ml-2 block text-sm font-medium text-gray-700">
              Enable SSML AI Enhancement
            </label>
          </div>
          <p className="mt-2 ml-6 text-xs text-gray-500">
            Use AI to enhance text-to-speech with SSML tags for improved prosody and emotion.
          </p>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleSave}
            disabled={loading}
            className="inline-flex items-center justify-center px-4 py-2 rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
