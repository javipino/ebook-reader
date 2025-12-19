interface LoadingSpinnerProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-6 w-6',
  md: 'h-12 w-12',
  lg: 'h-16 w-16'
};

export default function LoadingSpinner({ message, size = 'md' }: LoadingSpinnerProps) {
  return (
    <div className="text-center">
      <div className={`inline-block animate-spin rounded-full border-b-2 border-indigo-600 ${sizeClasses[size]}`} />
      {message && <p className="mt-4 text-gray-600">{message}</p>}
    </div>
  );
}
