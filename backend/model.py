from sqlalchemy import Column, String, Integer, Float, DateTime, Text, ForeignKey
from datetime import datetime
from database import Base

class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    format = Column(String)
    path = Column(String)
    rows_count = Column(Integer, default=0)
    uploaded_at = Column(DateTime, default=datetime.utcnow)


class TrainingJob(Base):
    __tablename__ = "training_jobs"

    id = Column(String, primary_key=True, index=True)
    dataset_id = Column(String, ForeignKey("datasets.id"))
    base_model = Column(String, default="gemma-2b")
    status = Column(String, default="pending")
    training_steps = Column(Integer, default=30)
    learning_rate = Column(Float, default=0.00005)
    loss_history = Column(Text, default="")
    accuracy = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)


class FineTunedModel(Base):
    __tablename__ = "models"

    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    base_model = Column(String)
    adapter_path = Column(String, default="")
    hf_repo = Column(String, default="")
    accuracy = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)