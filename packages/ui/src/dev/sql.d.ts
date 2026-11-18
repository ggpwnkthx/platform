/** SQL files the development build reads as text: the migrations and the seed. */
declare module '*.sql' {
  const text: string
  export default text
}
