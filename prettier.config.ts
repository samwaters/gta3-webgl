import { type Config } from "prettier"

const config: Config = {
    plugins: ["prettier-plugin-organize-imports"],
    semi: false,
    singleQuote: false,
    trailingComma: "all"
}

export default config