import { Layout } from "./components/layout/layout"
import { Home } from "./pages/home/home"
import { Models } from "./pages/models/models"
import { Scenes } from "./pages/scenes/scenes"
import { City } from "./pages/city/city"

export const Routes = [
  {
    path: "/",
    Component: Layout,
    children: [
      { Component: Home, index: true },
      { Component: Models, path: "models" },
      { Component: Scenes, path: "scenes" },
      { component: City, path: "city" },
    ],
  },
]
