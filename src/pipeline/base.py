from abc import ABC, abstractmethod


class Pipeline(ABC):
    @abstractmethod
    async def initiate(self):
        pass