const util = require('../lib/util')
const { expect } = require('chai').use(require('chai-like'))



describe('util 测试', function () {
  it('removeComment 无注释', function () {
    let string = 'line1\n*line2\nline3"#not comment"'
    let newString = util.removeComment(string)
    expect(newString).to.be.equal(string)
  })

  it('removeComment 单行', function () {
    let string = 'line1\n#comment1\nline3#comment2\nline4//comment3  '
    let newString = util.removeComment(string)
    expect(newString).to.be.equal('line1\n\nline3\nline4')


    string = 'line1\n#comment1\nline3"#comment2"\nline4//comment3  '
    newString = util.removeComment(string)
    expect(newString).to.be.equal('line1\n\nline3"#comment2"\nline4')
  })

  it('removeComment 多行', function () {
    let string = 'line1\n/*comment1  #line2\nline3*/line3.2\nline4'
    let newString = util.removeComment(string)
    expect(newString).to.be.equal('line1\nline3.2\nline4')

    string = 'line1\n"/*comment1"#line2\nline3*/line3.2\nline4'
    newString = util.removeComment(string)
    expect(newString).to.be.equal('line1\n"/*comment1"\nline3*/line3.2\nline4')
  })


  it('removeComment  outComment', function () {
    let outComment = []
    let string = 'line1\n/*comment1  #line2\nline3*/line3.2\nline4'
    let newString = util.removeComment(string, undefined, outComment)
    expect(newString).to.be.equal('line1\nline3.2\nline4')
    expect(outComment).to.be.deep.equal([{ str: '/*comment1  #line2\nline3*/', start: 6, end: 32 }])

    string = 'line1\n"/*comment1"#line2\nline3*/line3.2\nline4'
    newString = util.removeComment(string)
    expect(newString).to.be.equal('line1\n"/*comment1"\nline3*/line3.2\nline4')
  })

  it('splitByQuotes 普通', function () {
    let string = 'out1\'s1\'out2`s2`out3'
    let items = util.splitByQuote(string)
    expect(items).to.be.deep.equal([
      { str: 'out1', start: 0, end: 4, out: true },
      { str: '\'s1\'', start: 4, end: 8, char: '\'', in: true },
      { str: 'out2', start: 8, end: 12, out: true },
      { str: '`s2`', start: 12, end: 16, char: '`', in: true },
      { str: 'out3', start: 16, end: 20, out: true },
    ])
    expect(string).to.be.equal(items.map(item => item.str).join(''))
  })

  it('splitByQuotes 内有转义符', function () {
    let string = 'out1\'s\\\'1\'out2`s\'\\`2`out3'
    let items = util.splitByQuote(string)
    expect(items).to.be.deep.equal([
      { str: 'out1', start: 0, end: 4, out: true },
      { str: '\'s\\\'1\'', start: 4, end: 10, char: '\'', in: true },
      { str: 'out2', start: 10, end: 14, out: true },
      { str: '`s\'\\\`2`', start: 14, end: 21, char: '`', in: true },
      { str: 'out3', start: 21, end: 25, out: true, },
    ])
    expect(string).to.be.equal(items.map(item => item.str).join(''))
  })


  it('splitByQuotes in', function () {
    let string = 'out1\'s\\\'1\'out2`s\'\\`2`out3'
    let items = util.splitByQuote(string, { type: 'in' })
    expect(items).to.be.deep.equal([
      { str: '\'s\\\'1\'', start: 4, end: 10, char: '\'', in: true },
      { str: '`s\'\\\`2`', start: 14, end: 21, char: '`', in: true },
    ])
  })

  it('splitByQuotes out', function () {
    let string = 'out1\'s\\\'1\'out2`s\'\\`2`out3'
    let items = util.splitByQuote(string, { type: 'out' })
    expect(items).to.be.deep.equal([
      { str: 'out1', start: 0, end: 4, out: true },
      { str: 'out2', start: 10, end: 14, out: true },
      { str: 'out3', start: 21, end: 25, out: true },
    ])
  })


  it('splitByQuotes in char', function () {
    let string = 'out1\'s\\\'1\'out2`s\'\\`2`out3'
    let items = util.splitByQuote(string, { type: 'in', char: '`' })
    expect(items).to.be.deep.equal([
      { str: '`s\'\\\`2`', start: 14, end: 21, char: '`', in: true },
    ])
  })

  it('splitByQuotes out char', function () {
    let string = 'out1\'s\\\'1\'out2`s\'\\`2`out3'
    let items = util.splitByQuote(string, { type: 'out', char: '`' })
    expect(items).to.be.deep.equal([
      { str: 'out1\'s\\\'1\'out2', start: 0, end: 14, out: true },
      { str: 'out3', start: 21, end: 25, out: true },
    ])
  })

  it('splitOutQuotes', function () {
    let string = 'out1,out2`in1,in2`out3,out4,'
    let splits = util.splitOutQuote(string, ',', { char: '`' })
    expect(splits).to.be.deep.equal(['out1', 'out2`in1,in2`out3', 'out4', ''])
  })

  it('changeByQuote', function () {
    let string = 'out1,out2`in1,in2`out3,out4,'
    let newString = util.changeByQuote(string, { char: '`' }, item => `[${item.str}]`)
    expect(newString).to.be.deep.equal('[out1,out2][`in1,in2`][out3,out4,]')
  })


  it('findEnclosedString', function () {
    let string = 'out1(in1)out2(in2(in3)in4)'
    let strings = util.findEnclosedString(string, '()', 1).map(s => s.str)
    expect(strings).to.be.deep.equal(['in1'])

    strings = util.findEnclosedString(string, '()', 2).map(s => s.str)
    expect(strings).to.be.deep.equal(['in1', 'in2(in3)in4'])
  })


  it('findByQuote', function () {
    let string = 'a-1 a-2 `a-3` a4 ab-5 a-11 \'a-2\''
    let results = util.findByQuote(string, /\b\w-(\d+)/g, { type: 'out' })
    expect(results).to.be.deep.equal([['a-1', '1'], ['a-11', '11']])

    results = util.findByQuote(string, /\b\w-(\d+)/g, { type: 'out' })
    expect(results).to.be.deep.equal([['a-1', '1'], ['a-2', '2'], ['a-11', '11']])
  })

})