'use strict'

module.exports = {

  //按引号分割字符串, 
  splitByQuote(string, { type = 'all', char = '\'`"', escape = '\\' } = {}) {
    let inChar = ''
    let isEscape = false
    let start = 0
    let lastIndex = 0
    let items = []
    for (let i = 0; i < string.length; i++) {
      if (isEscape) {
        isEscape = false
        continue
      }
      let c = string[i]
      if (inChar) {
        if (c == inChar) {//结束
          if (type == 'all' || type == 'out') {
            let str = string.slice(lastIndex, start)
            if (str) items.push({ str, start: lastIndex, end: start, out: true }) //没有char 是out
          }
          if (type == 'all' || type == 'in') {
            let str = string.slice(start, i + 1)
            items.push({ str, start, end: i + 1, char: inChar, in: true })
          }
          lastIndex = i + 1
          inChar = ''
        } else if (c == escape) isEscape = true
      } else {
        if (char.includes(c)) {//开始
          inChar = c
          start = i
        }
      }
    }
    if (inChar) throw new Error('字符串未结束')
    if (type == 'all' || type == 'out') {
      let str = string.slice(lastIndex)
      if (str) items.push({ str, start: lastIndex, end: string.length, out: true })
    }
    return items
  },

  splitOutQuote(string, separator, opts={}) {
    opts.type = 'all' // 外部指定无效, 是通过 out 字符串分隔, 这里默认 all 是为了获取完整信息
    let items = this.splitByQuote(string, opts)
    let lastStr = ''
    let results = []
    for (const { str, start, end, char } of items) {
      if (!char) {
        let splits = str.split(separator)
        if (splits.length <= 1) {//没有分割
          lastStr += str
          continue
        }
        results.push(lastStr + splits[0])
        lastStr = splits[splits.length - 1]
        for (let i = 1; i < splits.length - 1; i++) {//忽略最后一个
          results.push(splits[i])
        }
      } else {
        lastStr += str
      }
    }
    results.push(lastStr)
    return results
  },

  forEachQuoteItems(items, type, cb) {
    if (type == 'all') {
      items.forEach((item, i) => cb(item, i))
    } else {
      items.forEach((item, i) => {
        if (item[type]) cb(item, i)
      })
    }
  },

  changeByQuote(string, opts, cb) {
    let newOpts = Object.assign({}, opts, { type: 'all' })
    let items = this.splitByQuote(string, newOpts)
    let changes = {}
    this.forEachQuoteItems(items, opts.type || 'all', (item, i) => {
      changes[i] = cb(item, i)
    })
    let newContent = ''
    items.forEach(({ str }, i) => newContent += changes.hasOwnProperty(i) ? changes[i] : str)
    return newContent
  }
}