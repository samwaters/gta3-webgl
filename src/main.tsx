import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./reset.css"
import "./index.css"
import { App } from "./app"
import { Provider } from "react-redux"
import { store } from "./store/store.ts"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
)
