"""Small async stand-ins for Redis and the SQLAlchemy session."""

from collections import deque


class FakeRedis:
    def __init__(self):
        self.data = {}
        self.expired = []

    async def get(self, key):
        return self.data.get(key)

    async def setex(self, key, ttl, value):
        self.data[key] = value

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data:
            return False
        self.data[key] = value
        return True

    async def delete(self, key):
        self.data.pop(key, None)

    async def exists(self, key):
        return key in self.data

    async def expire(self, key, ttl):
        self.expired.append(key)
        return key in self.data


class FakeResult:
    def __init__(self, value=None):
        self.value = value

    def first(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value

    def scalars(self):
        return self

    def all(self):
        return list(self.value or [])


class FakeSession:
    """Answers execute() calls from a queue; extra calls return empty results."""

    def __init__(self, results=()):
        self.results = deque(results)
        self.added = []
        self.executed = []
        self.commits = 0
        self.objects = {}

    async def execute(self, stmt):
        self.executed.append(stmt)
        return self.results.popleft() if self.results else FakeResult()

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pass

    async def get(self, model, key):
        return self.objects.get((model, key))
