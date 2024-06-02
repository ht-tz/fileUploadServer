/*
 * @Author: htz
 * @Date: 2024-06-01 11:46:09
 * @LastEditors: Please set LastEditors
 * @LastEditTime: 2024-06-02 21:03:47
 * @Description: 文件上传服务端
 */

const express = require('express'),
  fs = require('fs'),
  bodyParser = require('body-parser'),
  multiparty = require('multiparty'),
  SparkMD5 = require('spark-md5')

const app = express(),
  PORT = 8888
HOST = 'http://127.0.0.1'
HOSTNAME = `${HOST}:${PORT}`
app.listen(PORT, () => {
  console.log(
    `THE WEB SERVICE IS CREATED SUCCESSFULLY AND IS LISTENING TO THE PORT：${PORT}，YOU CAN VISIT：${HOSTNAME}`
  )
})

//中间件
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  req.method === 'OPTIONS' ? res.send('CURRENT SERVICES SUPPORT CROSS DOMAIN REQUESTS!') : next()
})
app.use(
  bodyParser.urlencoded({
    extended: false,
    limit: '1024mb',
  })
)
/*-API-*/
// 延迟函数
const delay = function delay(interval) {
  typeof interval !== 'number' ? (interval = 1000) : null
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, interval)
  })
}

// 检测文件是否存在
const exits = function exits(path) {
  return new Promise((resolve) => {
    fs.access(path, fs.constants.F_OK, (err) => {
      if (err) {
        resolve(false)
        return
      }
      resolve(true)
    })
  })
}

// 创建文件并写入指定目录
const writeFile = function writeFile(res, path, file, fileName, stream) {
  return new Promise((resolve, reject) => {
    if (stream) {
      try {
        let readStream = fs.createReadStream(file.path),
          writeSream = fs.createWriteStream(path)
        readStream.pipe(writeSream)
        readStream.on('end', () => {
          resolve()
          //上传文件后删除上传的文件
          fs.unlinkSync(file.path)
          res.send({
            code: 0,
            codeText: 'upload success',
            originalFileName: fileName,
            servicePath: path.replace(__dirname, HOSTNAME),
          })
        })
      } catch (err) {
        reject(err)
        res.send({
          code: 1,
          codeText: err,
        })
      }
      return
    }

    fs.writeFile(path, file, (err) => {
      if (err) {
        reject(err)
        res.send({
          code: 1,
          codeText: err,
        })
        return
      }
      resolve()
      res.send({
        code: 0,
        codeText: 'upload success',
        originalFilename: fileName,
        servicePath: path.replace(__dirname, HOSTNAME),
      })
    })
  })
}

// 基于multiparty插件实现文件上传处理 & form-data解析
const uploadDir = `${__dirname}/upload`
const multiparty_upload = function multiparty_upload(req, auto) {
  typeof auto !== 'boolean' ? (auto = false) : null
  let config = {
    maxFieldsSize: 200 * 1024 * 1024,
  }
  if (auto) config.uploadDir = uploadDir

  return new Promise(async (resolve, reject) => {
    await delay()
    new multiparty.Form(config).parse(req, (err, fields, files) => {
      if (err) {
        reject(err)
        return
      }
      resolve({
        fields,
        files,
      })
    })
  })
}

//单文件上传， 处理formData
app.post('/upload_single', async (req, res) => {
  try {
    let { files } = await multiparty_upload(req, true)
    let file = (files.file && files.file[0]) || {}
    res.send({
      code: 0,
      codeText: 'upload success',
      originalFilename: file.originalFilename,
      servicePath: file.path.replace(__dirname, HOSTNAME),
    })
  } catch (error) {
    console.log(error)
    res.send({
      code: 1,
      codeText: error,
    })
  }
})

//上传文件名称
app.post('/upload_name', async (req, res) => {
  try {
    let { files, fields } = await multiparty_upload(req, true)
    let file = (files.file && files.file[0]) || {},
      filename = (fields.filename && fields.filename[0]) || '',
      path = `${uploadDir}/${filename}`
    isExists = false
    isExists = await exits(path)
    // 存在的话
    if (isExists) {
      res.send({
        code: 0,
        codeText: 'upload success',
        originalFileName: filename,
        servicePath: path.replace(__dirname, HOSTNAME),
      })
      return
    }
    writeFile(res, path, file, filename, true)
  } catch (error) {
    res.send({
      code: 1,
      codeText: error,
    })
  }
})

// base64文件上传
app.post('/upload_base64', async (req, res) => {
  let file = req.body.file,
    filename = req.body.filename,
    spark = new SparkMD5.ArrayBuffer(),
    reg = /\.([0-9a-zA-Z]+)$/,
    suffix = reg.exec(filename)[1],
    isExists = false,
    path
  file = decodeURIComponent(file)
  //去去除前缀
  file = file.replace(/^data:image\/\w+;base64,/, '')
  //base64 编码转位2进制数据
  file = Buffer.from(file, 'base64')
  // 计算文件的hash值
  spark.append(file)
  //生成文件的路径（唯一路径）
  path = `${uploadDir}/${spark.end()}.${suffix}`
  await delay()
  // 检测是否存在
  isExists = await exits(path)
  if (isExists) {
    res.send({
      code: 0,
      codeText: 'upload success',
      originalFileName: filename,
      servicePath: path.replace(__dirname, HOSTNAME),
    })
    return
  }
  writeFile(res, path, file, filename, false)
})

//大文切片上传， 合并切片
const merge = function merge(HASH, count) {
  return new Promise(async (resolve, reject) => {
    let path = `${uploadDir}/${HASH}`,
      fileList = [],
      suffix,
      isExists
    isExists = await exits(path)
    if (!isExists) {
      reject('HASH path is not found!')
      return
    }
    // 读取所有文件和子目录的名称的数组
    fileList = fs.readdirSync(path)

    if (fileList.length < count) {
      reject('the slice has not been uploaded!')
      return
    }
    // 删除原来文件片段，将他们合并成为一个新的完整的文件片段
    fileList
      .sort((a, b) => {
        //使用正则表达式 _(\d+) 提取文件名中的序号，并按照序号进行排序。
        //提取文件中叙好，对文件列表进行排序
        let reg = /_(\d+)/
        return reg.exec(a)[1] - reg.exec(b)[1]
      })
      .forEach((item) => {
        // 如果 suffix 为空，则提取第一个文件片段的后缀名。
        !suffix ? (suffix = /\.([0-9a-zA-Z]+)$/.exec(item)[1]) : null
        // 合并文件片段， fs.readFileSnyc 读取文件片段， fs.appendFileSync 将文件片段追加到新文件中
        fs.appendFileSync(`${uploadDir}/${HASH}.${suffix}`, fs.readFileSync(`${path}/${item}`))
        //删除已经读区的文件片段
        fs.unlinkSync(`${path}/${item}`)
      })
    //  删除文件片段目录 只能删除空目录
    fs.rmdirSync(path)
    resolve({
      path: `${uploadDir}/${HASH}.${suffix}`, //合并后的文件路径
      filename: `${HASH}.${suffix}`, // 合并后的文件名称
    })
  })
}

// 上传文件片段
app.post('/upload_chunk', async (req, res) => {
  try {
    let { files, fields } = await multiparty_upload(req)
    let file = (files.file && files.file[0]) || {},
      filename = (fields.filename && fields.filename[0]) || '',
      path = ''
    console.log(fields)
    //创建存放切片的临时目录
    // 从文件中提取hash值 便于后续处理
    // let [, HASH] 将数组的第二个元素（即 abc123）赋值给 HASH。
    let [, HASH] = /^([^_]+)_(\d+)/.exec(filename)
    path = `${uploadDir}/${HASH}`

    !fs.existsSync(path) ? fs.mkdirSync(path) : null
    //把切片存储到临时目录当中
    path = `${uploadDir}/${HASH}/${filename}`
    isExists = await exits(path)

    if (isExists) {
      res.send({
        code: 0,
        codeText: 'upload success',
        originalFileName: filename,
        servicePath: path.replace(__dirname, HOSTNAME),
      })
      return
    }
    writeFile(res, path, file, filename, true)
  } catch (error) {
    res.send({
      code: 1,
      error: 'xxx',
    })
  }
})

app.get('/upload_already', async (req, res) => {
  let { HASH } = req.query
  let path = `${uploadDir}/${HASH}`,
    fileList = []
  try {
    fileList = fs.readdirSync(path)
    fileList = fileList.sort((a, b) => {
      let reg = /_(\d+)/
      return reg.exec(a)[1] - reg.exec(b)[1]
    })
    res.send({
      code: 0,
      codeText: '',
      fileList: fileList,
    })
  } catch (error) {
    res.send({
      code: 1,
      codeText: '',
      fileList: fileList,
    })
  }
})

// 合并文件片段
app.post('/upload_merge', async (req, res) => {
  let { HASH, count } = req.body
  console.log(HASH, count)
  try {
    let { filename, path } = await merge(HASH, count)
    res.send({
      code: 0,
      codeText: 'upload success',
      originalFileName: filename,
      servicePath: path.replace(__dirname, HOSTNAME),
    })
  } catch (error) {
    res.send({
      code: 1,
      codeText: error,
    })
  }
})

app.use(express.static('./'))
app.use((req, res) => {
  res.status(404)
  res.send('Nothin found')
})
