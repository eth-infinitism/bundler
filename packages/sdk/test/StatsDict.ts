// given dict param, collect stats for each key
export class StatsDict {
  dict: { [key: string]: MinMaxAvg } = {}

  reset (): void {
    this.dict = {}
  }

  get (name: string): MinMaxAvg {
    return this.dict[name] ?? new MinMaxAvg()
  }

  add (n: any): this {
    for (const k in n) {
      if (this.dict[k] == null) {
        this.dict[k] = new MinMaxAvg()
      }
      this.dict[k].addSample(n[k])
    }
    return this
  }

  result (): { [key: string]: string } {
    const res: { [key: string]: string } = {}
    for (const k in this.dict) {
      if (this.dict[k].min !== this.dict[k].max) {
        res[k] = this.dict[k].stats()
      }
    }
    return res
  }

  // report all modified fields (those with max!=max)
  dump (): void {
    console.log(this.result())
  }
}

class MinMaxAvg {
  min?: number
  max?: number
  tot?: number
  count?: number

  reset (): void {
    this.min = undefined
    this.max = undefined
    this.tot = undefined
  }

  stats (): string {
    return `${this.min}/${this.avg()}/${this.max} [${this.max! - this.min!}]`
  }

  avg (): number {
    return Math.round((this.tot ?? 0) / (this.count ?? 1))
  }

  addSample (n: number): void {
    if (this.min == null || n < this.min) {
      this.min = n
    }
    if (this.max == null || n > this.max) {
      this.max = n
    }
    this.tot = (this.tot ?? 0) + n
    this.count = (this.count ?? 0) + 1
  }
}
