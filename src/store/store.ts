import { configureStore } from "@reduxjs/toolkit"
import { createLogger } from "redux-logger"
import createSagaMiddleware from "redux-saga"
import { rootSaga } from "./root.saga"
import { assetsReducer } from "./assets/assets.slice"
import { bootstrapReducer } from "./bootstrap/bootstrap.slice"
import { menuReducer } from "./menu/menu.slice"
import { workersReducer } from "./workers/workers.slice"

const sagaMiddleware = createSagaMiddleware()
const logger = createLogger()

export const store = configureStore({
  reducer: {
    assets: assetsReducer,
    bootstrap: bootstrapReducer,
    menu: menuReducer,
    workers: workersReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ thunk: false }).concat(sagaMiddleware, logger),
})

sagaMiddleware.run(rootSaga)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
