export const isBillableChain = (chainId: number): boolean => {
  return [1, 10, 42161, 1313161554, 137, 43114].includes(chainId)
}
