import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./reset.css"
import "./index.css"
import { App } from "./app"
import { WorkerPool } from "./worker/pool.ts"
import type { WorkerReply } from "./worker/types.ts"
import { CommandsEnum } from "./worker/commands.ts"
import { Provider } from "react-redux"
import { store } from "./store/store.ts"

WorkerPool.initialise(5)

const fetchHandler = (response: WorkerReply) => {
  console.log("fetch complete handler", response)
}

const fetchErrorHandler = (response: WorkerReply) => {
  console.log("fetch error handler", response)
}

const fetchProgressHandler = (response: WorkerReply) => {
  console.log("fetch progress handler", response)
}

WorkerPool.debug()

WorkerPool.run(
  CommandsEnum.CHECK,
  `FOO-1`,
  fetchHandler,
  fetchErrorHandler,
  fetchProgressHandler,
)

setTimeout(() => {
  WorkerPool.debug()
}, 10000)
WorkerPool.debug()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
)
