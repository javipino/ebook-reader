import { useState, useEffect } from 'react';
import api from '../services/api';

interface BookCoverProps {
  bookId: string;
  coverImageUrl: string | null | undefined;
  className?: string;
  children?: React.ReactNode;
}

export default function BookCover({ bookId, coverImageUrl, className = '', children }: BookCoverProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let blobUrl: string | null = null;

    const fetchCover = async () => {
      if (!coverImageUrl) {
        // No cover URL - try to extract it
        try {
          const extractResponse = await api.post(`/api/books/${bookId}/extract-cover`);
          if (extractResponse.data?.coverImageUrl) {
            // Cover extracted successfully, now fetch it
            const response = await api.get(extractResponse.data.coverImageUrl, {
              responseType: 'blob'
            });
            blobUrl = URL.createObjectURL(response.data);
            setImageUrl(blobUrl);
            setError(false);
            setLoading(false);
            return;
          }
        } catch {
          // Extraction failed, show placeholder
        }
        setLoading(false);
        setError(true);
        return;
      }

      try {
        const response = await api.get(coverImageUrl, {
          responseType: 'blob'
        });
        
        blobUrl = URL.createObjectURL(response.data);
        setImageUrl(blobUrl);
        setError(false);
      } catch (err: any) {
        // If 404, try to extract the cover
        if (err.response?.status === 404) {
          try {
            const extractResponse = await api.post(`/api/books/${bookId}/extract-cover`);
            if (extractResponse.data?.coverImageUrl) {
              const response = await api.get(extractResponse.data.coverImageUrl, {
                responseType: 'blob'
              });
              blobUrl = URL.createObjectURL(response.data);
              setImageUrl(blobUrl);
              setError(false);
              setLoading(false);
              return;
            }
          } catch {
            // Extraction failed
          }
        }
        console.error('Error fetching cover image:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchCover();

    // Cleanup blob URL on unmount
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [bookId, coverImageUrl]);

  if (loading) {
    return (
      <div className={`bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center animate-pulse ${className}`}>
        <div className="text-4xl">📚</div>
        {children}
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div className={`bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center ${className}`}>
        {!children && <div className="text-6xl">📖</div>}
        {children}
      </div>
    );
  }

  return (
    <div 
      className={`bg-cover bg-center ${className}`}
      style={{ backgroundImage: `url(${imageUrl})` }}
    >
      {children}
    </div>
  );
}
