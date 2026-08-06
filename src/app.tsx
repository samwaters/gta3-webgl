import { RouterProvider } from "react-router/dom"
import { createBrowserRouter } from "react-router"
import { Routes } from "./routes"
import { useEffect } from "react"
import { useAppDispatch } from "./store/hooks"
import { bootstrapReady } from "./store/bootstrap/bootstrap.slice"
import { startWorkerPool } from "./store/workers/workers.slice"

export const App = () => {
  const dispatch = useAppDispatch()
  useEffect(() => {
    dispatch(bootstrapReady(true))
    dispatch(startWorkerPool())
  }, [])

  const router = createBrowserRouter(Routes)
  return (
    <>
      <RouterProvider router={router} />
    </>
  )
}
