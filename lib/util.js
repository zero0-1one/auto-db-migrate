'use strict'

module.exports = {
  _costComment(string, start, pairs) {
    for (const [strBegin, strEnd, isSingle] of pairs) {
      if (string.slice(start, start + strBegin.length) == strBegin) {
        let index = string.indexOf(strEnd, start + strBegin.length)
        if (index == -1) return string.length
        return isSingle ? index : index + strEnd.length  //单行注释不包含 strEnd
      }
    }
  },

  removeComment(string, opts, outComment) {
    let { type = 'all', char = '\'`"', escape = '\\', single = ['#', '//'], multi = [['/*', '*/']] } = opts || {}
    let inChar = ''
    let isEscape = false
    let newString = ''
    let lastIndex = 0
    let pairs = multi.slice(0)
    pairs.push(...single.map(c => [c, '\n', true]))
    for (let i = 0; i < string.length; i++) {
      if (isEscape) {
        isEscape = false
        continue
      }
      let c = string[i]
      if (inChar) {
        if (c == inChar) {//结束
          inChar = ''
        } else if (c == escape) {
          isEscape = true
        }
      } else {//未在字符串内
        let index = this._costComment(string, i, pairs)
        if (index !== undefined) {
          if (outComment) outComment.push({ str: string.slice(i, index), start: i, end: index })
          newString += string.slice(lastIndex, i)
          lastIndex = index
          i = index - 1
          continue
        }
        if (char.includes(c)) {//开始
          inChar = c
        }
      }
    }
    newString += string.slice(lastIndex)
    return newString
  },
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
    if (inChar) return//throw new Error('字符串未结束')
    if (type == 'all' || type == 'out') {
      let str = string.slice(lastIndex)
      if (str) items.push({ str, start: lastIndex, end: string.length, out: true })
    }
    return items
  },

  //count =0 查找所有
  findEnclosedString(str, [begin, end] = '()', count = 0, start = 0) {
    let stack = []
    let strings = []
    for (let i = start; i < str.length; i++) {
      let c = str[i]
      if (c == begin) {
        stack.push(i + 1)
      } else if (c == end) {
        if (stack.length == 0) throw new Error('存在未闭合的括号')
        let index = stack.pop()
        if (stack.length == 0) {
          strings.push({
            str: str.slice(index, i),
            start: index,
            end: i,
          })
          if (count > 0 && strings.length >= count) break
        }
      }
    }
    if (stack.length > 0) throw new Error('存在未闭合的括号')
    return strings
  },

  //获取所有(最外层,不递归)被括号包裹的字符串
  getEnclosedStringAllByQuote(string, brackets = '()', opts = {}) {
    let items = null
    if (opts.type == 'all') {
      items = [{ str: string, start: 0, end: string.length, out: true }]
    } else {
      if (opts.type === undefined) opts.type = 'out' //默认out
      items = this.splitByQuote(string, opts)
    }
    let strings = []
    for (const { str, start } of items) {
      while (true) {
        let s = this.findEnclosedString(str, brackets, start)
        if (s === undefined) break
        strings.push(s)
      }
    }
    return strings
  },


  splitOutQuote(items, separator, opts = {}) {
    if (typeof items == 'string') {
      opts.type = 'all' // 外部指定无效, 是通过 out 字符串分隔, 这里默认 all 是为了获取完整信息
      items = this.splitByQuote(items, opts)
    }
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

  // items : string 或 splitByQuote返回值
  findByQuote(items, reg, opts = {}) {
    if (typeof items == 'string') {
      items = this.splitByQuote(items, opts)
    }
    let all = []
    for (const { str } of items) {
      let results = str.matchAll(reg)
      all.push(...results)
    }
    return all
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

  // items : string 或 splitByQuote返回值
  changeByQuote(items, opts, cb) {
    if (typeof items == 'string') {
      let newOpts = Object.assign({}, opts, { type: 'all' })
      items = this.splitByQuote(items, newOpts)
    }
    let changes = {}
    this.forEachQuoteItems(items, opts.type || 'all', (item, i) => {
      let old = item.str
      changes[i] = cb(item, i) || old
    })
    let newContent = ''
    items.forEach(({ str }, i) => newContent += changes.hasOwnProperty(i) ? changes[i] : str)
    return newContent
  },



  // _showTime(str) {
  //   let end = process.hrtime.bigint()
  //   if (this.__begin) console.log(Number(end - this.__begin) / 1000000, '毫秒', str)
  //   this.__begin = end
  // },
  // _showTimeBegin() {
  //   this.__begin = process.hrtime.bigint()
  // },
}