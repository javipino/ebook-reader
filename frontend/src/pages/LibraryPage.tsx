export default function LibraryPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">My Library</h1>
      
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <div className="text-6xl mb-4">📚</div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No books yet</h2>
        <p className="text-gray-600 mb-6">
          Upload your first ebook to get started with AI-powered narration.
        </p>
        <button className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
          Upload Book
        </button>
      </div>
    </div>
  )
}
