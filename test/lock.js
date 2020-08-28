
var track = require('./support').track
var integration = require('..')
var assert = require('assert')
var Redis = require('ioredis')
var Batch = require('batch')

describe('lock', function () {
  var segment
  var db
  var msgs

  beforeEach(function (done) {
    db = new Redis()
    db.on('error', done)
    db.on('ready', done)
  })

  beforeEach(function () {
    var Segment = integration('Segment.io')
    Segment.endpoint('http://dummy.io')
    segment = Segment()
    segment.redis(db)
  })

  afterEach(function (done) {
    db.del('users', done)
  })

  beforeEach(function () {
    msgs = [
      track({ userId: 1, event: 'a' }),
      track({ userId: 1, event: 'b' }),
      track({ userId: 1, event: 'c' }),
      track({ userId: 1, event: 'd' }),
      track({ userId: 1, event: 'f' }),
      track({ userId: 2, event: 'e' })
    ]
  })

  it('should prefix with the integration name', function (done) {
    segment.lock('some-key', function () {
      db.exists('Segment.io:some-key', function (err, exists) {
        if (err || !exists) return done(err || new Error('expected key to exists'))
        segment.unlock('some-key', done)
      })
    })
  })

  describe('without lock', function () {
    it('should override previous event', function (done) {
      var batch = new Batch()
      segment.track = withoutLock

      msgs.forEach(function (msg) {
        batch.push(function (done) {
          segment.track(msg, done)
        })
      })

      batch.end(function (err) {
        if (err) return done(err)
        db.hgetall('users', function (err, vals) {
          if (err) return done(err)
          assert.deepEqual(vals, { 1: 'f', 2: 'e' })
          done()
        })
      })
    })
  })

  describe('with lock', function () {
    it('should return errors for any locks already aquired', function (done) {
      var batch = new Batch()
      segment.track = withLock

      msgs.forEach(function (msg) {
        batch.push(function (done) {
          segment.track(msg, done)
        })
      })

      batch.end(function (err) {
        if (err) assert(err.code === 'RESOURCE_LOCKED')
        db.hgetall('users', function (_, vals) {
          assert.deepEqual(vals, { 1: 'a', 2: 'e' })
          done()
        })
      })
    })
  })

  describe('with timed lock', function () {
    it('should return errors for any locks already aquired', function (done) {
      var batch = new Batch()
      segment.track = withTimedLock

      msgs.forEach(function (msg) {
        batch.push(function (done) {
          segment.track(msg, done)
        })
      })

      batch.end(function (err) {
        if (err) assert(err.code === 'RESOURCE_LOCKED')
        db.hgetall('users', function (_, vals) {
          assert.deepEqual(vals, { 1: 'a', 2: 'e' })
          done()
        })
      })
    })
  })

  function withoutLock (msg, done) {
    db.hget('users', msg.userId(), function (err, val) {
      if (err) return done(err)
      if (val) return done()
      db.hset('users', msg.userId(), msg.event(), done)
    })
  }

  function withLock (msg, done) {
    var self = this
    this.lock(msg.userId(), function (err) {
      if (err) return done()
      db.hget('users', msg.userId(), function (err, value) {
        if (err) return self.unlock(msg.userId(), done)
        if (value) return self.unlock(msg.userId(), done)
        db.hset('users', msg.userId(), msg.event(), function (err) {
          self.unlock(msg.userId(), function () {
            done(err)
          })
        })
      })
    })
  }

  function withTimedLock (msg, done) {
    var self = this
    this.lock(msg.userId(), 30000, function (err) {
      if (err) return done()
      db.hget('users', msg.userId(), function (err, value) {
        if (err) return self.unlock(msg.userId(), done)
        if (value) return self.unlock(msg.userId(), done)
        db.hset('users', msg.userId(), msg.event(), function (err) {
          self.unlock(msg.userId(), function () {
            done(err)
          })
        })
      })
    })
  }
})
