import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './reset.css'
import './index.css'
import { App } from './app'
import {WorkerPool} from "./worker/pool.ts";
import type {WorkerReply} from "./worker/types.ts";
import {CommandsEnum} from "./worker/commands.ts";

WorkerPool.initialise(5)

const fetchHandler = (response: WorkerReply) => {
    console.log(response)
}

WorkerPool.debug()

// WorkerPool.run(CommandsEnum.FETCH, `FOO-1`, fetchHandler)

for(let i=0; i<20; i++) {
    WorkerPool.run(CommandsEnum.FETCH, `FOO-${i}`, fetchHandler)
}

setTimeout(() => {
    WorkerPool.debug()
}, 10000)
WorkerPool.debug()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
