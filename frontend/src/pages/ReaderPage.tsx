import { useParams } from 'react-router-dom'

export default function ReaderPage() {
  const { bookId } = useParams()

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Book Reader</h1>
        <p className="text-gray-600">Reading book ID: {bookId}</p>
        
        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-between">
            <button className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
              Previous
            </button>
            <span className="text-gray-600">Page 1 of 100</span>
            <button className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
              Next
            </button>
          </div>
          
          <div className="prose max-w-none">
            <p className="text-gray-800 leading-relaxed">
              Book content will be displayed here...
            </p>
          </div>

          <div className="mt-8 flex items-center space-x-4">
            <button className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">
              ▶️ Listen
            </button>
            <input 
              type="range" 
              min="0.5" 
              max="2" 
              step="0.1" 
              defaultValue="1" 
              className="w-32"
            />
            <span className="text-gray-600">1.0x</span>
          </div>
        </div>
      </div>
    </div>
  )
}
