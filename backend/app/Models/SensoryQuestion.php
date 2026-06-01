<?php

namespace App\Models;

/**
 * Table: sensory_questions (via Prisma @@map)
 */
class SensoryQuestion extends PrismaModel
{
    protected $table = 'sensory_questions';

    public $incrementing = false;
    protected $keyType = 'string';
    protected $primaryKey = 'question_id';
    public $timestamps = false;

    protected $fillable = [
        'question_id', 'test_id', 'attribute_id', 'question_text',
        'question_type', 'scale_type', 'order', 'created_at', 'updated_at',
    ];

    protected $casts = [
        'order' => 'integer',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function study()
    {
        return $this->belongsTo(Study::class, 'test_id', 'id');
    }

    public function attribute()
    {
        return $this->belongsTo(CoreAttribute::class, 'attribute_id', 'attribute_id');
    }

    public function responses()
    {
        return $this->hasMany(QuestionResponse::class, 'question_id', 'question_id');
    }
}
