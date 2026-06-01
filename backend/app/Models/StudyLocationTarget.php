<?php

namespace App\Models;

class StudyLocationTarget extends PrismaModel
{
    protected $table = 'study_location_targets';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'studyId', 'scope', 'regionId', 'provinceId', 'cityId',
        'barangayId', 'venueName', 'addressDetails',
        'inheritedFromFicUserId', 'createdAt', 'updatedAt',
    ];

    protected $casts = [
        'createdAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];

    public function study()
    {
        return $this->belongsTo(Study::class, 'studyId');
    }

    public function region()
    {
        return $this->belongsTo(PsgcRegion::class, 'regionId');
    }

    public function province()
    {
        return $this->belongsTo(PsgcProvince::class, 'provinceId');
    }

    public function city()
    {
        return $this->belongsTo(PsgcCity::class, 'cityId');
    }

    public function barangay()
    {
        return $this->belongsTo(PsgcBarangay::class, 'barangayId');
    }
}
