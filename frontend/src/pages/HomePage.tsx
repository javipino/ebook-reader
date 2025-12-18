export default function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl md:text-6xl">
          AI-Powered Ebook Reader
        </h1>
        <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
          Transform your reading experience with AI character recognition and personalized text-to-speech narration.
        </p>
        <div className="mt-5 max-w-md mx-auto sm:flex sm:justify-center md:mt-8">
          <div className="rounded-md shadow">
            <a
              href="/library"
              className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 md:py-4 md:text-lg md:px-10"
            >
              Get Started
            </a>
          </div>
        </div>
      </div>

      <div className="mt-16">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-3xl mb-4">🤖</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">AI Character Recognition</h3>
            <p className="text-gray-600">
              Automatically identifies main characters in your books for personalized voice selection.
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-3xl mb-4">🎙️</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Character Voices</h3>
            <p className="text-gray-600">
              Unique voices for each character make audiobooks come alive with personality.
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-3xl mb-4">🔄</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Kindle Sync</h3>
            <p className="text-gray-600">
              Seamlessly switch between reading and listening with Kindle synchronization.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
