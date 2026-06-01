export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen text-gray-500">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-lg">页面不存在</p>
      <a href="/" className="mt-4 text-blue-500 hover:underline">返回首页</a>
    </div>
  );
}
