import { configureStore } from "@reduxjs/toolkit"
import { createLogger } from "redux-logger"
import createSagaMiddleware from "redux-saga"
import { rootSaga } from "./root.saga"
import { bootstrapReducer } from "./bootstrap/bootstrap.slice"

const sagaMiddleware = createSagaMiddleware()
const logger = createLogger()

export const store = configureStore({
  reducer: {
    bootstrap: bootstrapReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ thunk: false }).concat(sagaMiddleware, logger),
})

sagaMiddleware.run(rootSaga)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
