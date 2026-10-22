/** Serializes sale planning and commit so two checkouts cannot reserve the same invoice. */
export function exclusive<Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) {
  const enqueue = serialQueue()
  return (...args: Args): Promise<Result> => enqueue(() => operation(...args))
}

/** One queue can coordinate multiple related entry points, such as account/PIN updates. */
export function serialQueue() {
  let tail = Promise.resolve()
  return <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}
