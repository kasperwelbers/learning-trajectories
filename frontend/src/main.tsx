import "./index.css"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ApiError } from "@/api/client"
import { router } from "./router"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Freshness comes from real-time invalidation; refetching on focus covers missed messages.
      staleTime: 60_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
})

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}
