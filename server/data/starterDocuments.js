/**
 * server/data/starterDocuments.js
 * 
 * WHY THIS MODULE IS NEEDED:
 * Provides canonical, academically rigorous lecture notes for the starter study materials:
 * 1. dbms-normalization.pdf: Database Management Systems & Relational Normalization.
 * 2. machine-learning-foundations.pdf: Machine Learning Core Principles & Optimization.
 * 
 * These documents are indexed directly into the ONE shared ByteMind study-material
 * and vector RAG pipeline on server boot, ensuring both Student Mode and Classroom
 * Assistant have real, grounded knowledge available out-of-the-box.
 */

export const STARTER_DOCUMENTS = [
  {
    documentId: 'dbms-normalization.pdf',
    filename: 'dbms-normalization.pdf',
    title: 'DBMS Notes: Relational Normalization & Schema Design',
    pageCount: 3,
    text: `
DATABASE MANAGEMENT SYSTEMS: RELATIONAL NORMALIZATION AND SCHEMA REFINEMENT

1. Introduction to Normalization
Database normalization is the systematic process of organizing data in a relational database to minimize data redundancy and eliminate undesirable insertion, update, and deletion anomalies. Normalization decomposes relations into smaller, well-structured relations using functional dependencies while preserving data consistency and lossless-join properties.

2. Database Anomalies in Unnormalized Relations
When a relational database contains redundant data:
- Insertion Anomaly: Inability to insert information about a student or course without having attributes for unrelated entities (e.g. cannot add a course until a student enrolls).
- Deletion Anomaly: Unintended loss of crucial data when a related record is deleted (e.g. deleting the last student in a course unintentionally erases all course details).
- Update/Modification Anomaly: Inconsistent updates across multiple rows when data is duplicated in multiple tuples, leading to contradictory data states.

3. Functional Dependencies (FDs)
A functional dependency X -> Y expresses a constraint between two sets of attributes X and Y in relation R. For any two tuples t1 and t2 in R, if t1[X] = t2[X], then t1[Y] must equal t2[Y]. Attribute set X is known as the determinant.
- Full Functional Dependency: Y is functionally dependent on X, and not dependent on any proper subset of X.
- Partial Dependency: A non-prime attribute is dependent on only a part of a composite candidate key.
- Transitive Dependency: An indirect functional dependency of the form X -> Y and Y -> Z, where Y is not a candidate key and Y does not determine X.

4. Normal Forms Hierarchy
- First Normal Form (1NF):
  A relation R is in 1NF if and only if every attribute domain contains only atomic (indivisible) values, each attribute contains only a single value from that domain, and there are no repeating groups or multivalued attributes.
- Second Normal Form (2NF):
  A relation R is in 2NF if it is in 1NF and every non-prime attribute is fully functionally dependent on the primary key. In other words, 2NF eliminates partial dependencies where an attribute depends on a proper subset of a composite primary key.
- Third Normal Form (3NF):
  A relation R is in 3NF if it is in 2NF and no non-prime attribute is transitively dependent on the primary key. Formally, for every non-trivial functional dependency X -> A, either X is a superkey of R, or A is a prime attribute (part of a candidate key).
- Boyce-Codd Normal Form (BCNF):
  BCNF is a stricter extension of 3NF. A relation R is in BCNF if and only if for every non-trivial functional dependency X -> A, X is a superkey of R. BCNF eliminates anomalies that can still occur in 3NF when a relation has multiple overlapping composite candidate keys.

5. Decomposition Properties
- Lossless-Join Decomposition: Decomposing relation R into R1 and R2 guarantees that joining R1 and R2 via natural join reconstructs the exact original relation R without generating spurious tuples. This holds if and only if the intersection of attributes (R1 ∩ R2) is a superkey of R1 or R2.
- Dependency Preservation: A decomposition preserves dependencies if the union of functional dependencies in the decomposed relations logically implies all original dependencies in R. Every relation can be decomposed into 3NF relations that are both lossless-join and dependency-preserving, whereas BCNF guarantees lossless-join but may not always preserve all functional dependencies.
`.trim(),
  },
  {
    documentId: 'machine-learning-foundations.pdf',
    filename: 'machine-learning-foundations.pdf',
    title: 'Machine Learning Notes: Supervised Learning & Optimization',
    pageCount: 3,
    text: `
MACHINE LEARNING FOUNDATIONS: SUPERVISED LEARNING, OBJECTIVE FUNCTIONS, AND OPTIMIZATION

1. Fundamentals of Supervised Learning
Supervised learning algorithms infer a mapping function f: X -> Y from labeled training data pairs {(x_1, y_1), (x_2, y_2), ..., (x_n, y_n)}.
- Regression Tasks: The output variable Y is continuous (e.g. predicting price, temperature, or housing values).
- Classification Tasks: The output variable Y is categorical or discrete (e.g. binary spam detection, medical diagnosis, multi-class image labeling).

2. Loss Functions and Empirical Risk
The loss function L(y_true, y_pred) measures the discrepancy between true target values and model predictions.
- Mean Squared Error (MSE): Widely used for regression, defined as (1/n) * Σ (y_i - y_hat_i)^2. Penalizes large errors quadratically.
- Mean Absolute Error (MAE): Defined as (1/n) * Σ |y_i - y_hat_i|. More robust to extreme outliers than MSE.
- Binary Cross-Entropy (Log Loss): Used for binary classification, defined as - (1/n) * Σ [y_i * log(p_i) + (1 - y_i) * log(1 - p_i)], penalizing confident incorrect classifications exponentially.

3. Optimization via Gradient Descent
Parameters θ of model f_θ(X) are optimized iteratively by calculating the gradient of the objective function with respect to weights:
θ_{t+1} = θ_t - η * ∇_θ J(θ), where η is the learning rate.
- Batch Gradient Descent: Computes loss gradient across the complete training dataset per update step. Computationally intensive for large corpora.
- Stochastic Gradient Descent (SGD): Updates parameters using a single randomly selected sample per iteration. Fast but noisy convergence trajectory.
- Mini-Batch Gradient Descent: Updates parameters using small subsets (e.g. 32, 64, or 128 samples), balancing computational vectorized throughput with convergence stability.

4. Generalization, Overfitting, and Regularization
- Overfitting: Occurs when a model memorizes idiosyncrasies, variance, and noise in the training dataset, exhibiting near-zero training error but high generalization error on unseen test data.
- Underfitting: Occurs when a model lacks structural capacity to capture underlying patterns, suffering high bias on both training and validation sets.
- L2 Regularization (Ridge / Weight Decay): Adds penalty term λ * Σ ||w||^2 to the loss function, shrinking weights smoothly toward zero and preventing extreme coefficient magnitudes.
- L1 Regularization (Lasso): Adds penalty term λ * Σ |w| to the loss function, driving less informative feature weights strictly to zero, yielding sparse feature selection.
`.trim(),
  },
];
