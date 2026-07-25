import {RouterProvider} from "react-router/dom";
import {createBrowserRouter} from "react-router";
import { Routes } from "./routes";

export const App = ()=> {
  const router = createBrowserRouter(Routes)
    return (
    <>
        <RouterProvider router={router} />
    </>
  )
}
